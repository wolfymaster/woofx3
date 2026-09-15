// SSE client for `/scene/{sceneId}/events`, with a hand-written
// reconnect/backoff loop -- ported in spirit (same exponential-backoff
// shape) from streamware/ui/src/lib/eventSource.ts's
// `WebSocketEventSource`. Deliberately NOT the native browser
// `EventSource` (whose reconnect cadence isn't fully controllable --
// see the design note in the plan about not depending on data-star's
// or the browser's own opaque reconnect timing) and NOT dependent on
// data-star's own SSE plugin: this is the thing that flips the
// `$connected` signal data-star's `data-show`/`data-class` react to,
// not something built on top of data-star's transport.
//
// On backoff cadence: sceneManager runs on the same machine as the
// overlay, so "disconnected" means its process is down, not that the
// user is off the network. A probe against a dead local port fails
// with ECONNREFUSED in microseconds and puts nothing on the wire, so
// the reason to back off is log/CPU noise in a browser source that may
// run for twelve hours -- not bandwidth. That's why the cap is low
// (seconds, not minutes): it bounds how long a recovered server keeps
// showing a stale banner, and the cost of that bound is nil.
// Coordination across sibling overlays is delegated to a
// ReconnectCoordinator (see reconnect-coordinator.ts).

import { ALWAYS_PROBE, type ReconnectCoordinator } from "./reconnect-coordinator";

export interface DeliveryFrame {
  eventId: string;
  instanceId: string;
  type: string;
  key: string;
  value: unknown;
}

/** The stream carries two frame kinds: per-event deliveries, and the
 *  `hello` control frame the server opens every stream with. */
export type SceneFrame = { kind: "delivery"; frame: DeliveryFrame } | { kind: "hello"; bootId: string };

export interface SceneEventSink {
  onFrame(frame: DeliveryFrame): void;
  onConnectionChange(connected: boolean): void;
  /** Server boot identity for the stream just opened. Changes across a
   *  sceneManager restart; see index.ts for what that triggers. */
  onHello?(bootId: string): void;
  /** The server rejected our session cookie. Unlike every other
   *  failure here, retrying cannot fix this -- see the note on
   *  SESSION_REJECTED_STATUSES. */
  onSessionExpired?(): void;
}

/** Statuses that mean "your session is no longer valid", as opposed to
 *  "the server is unreachable". Gated on `everConnected` at the call
 *  site: a page that has *never* connected and is immediately rejected
 *  would reload into the same rejection, so it keeps retrying (and
 *  keeps the banner up) rather than looping. */
const SESSION_REJECTED_STATUSES = new Set([401, 403]);

export interface SceneEventSourceOptions {
  url: string;
  fetchFn?: typeof fetch;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  coordinator?: ReconnectCoordinator;
  random?: () => number;
}

/** Parses one SSE frame into its typed form, or `null` for
 *  comment/keepalive lines and malformed payloads. */
export function parseSseChunk(rawEvent: string): SceneFrame | null {
  const lines = rawEvent.split("\n");
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLine = lines.find((line) => line.startsWith("data:"));
  if (!dataLine) {
    return null;
  }
  const json = dataLine.slice("data:".length).trim();
  if (!json) {
    return null;
  }
  const eventName = eventLine ? eventLine.slice("event:".length).trim() : "";

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  if (eventName === "hello") {
    return typeof parsed.bootId === "string" && parsed.bootId.length > 0
      ? { kind: "hello", bootId: parsed.bootId }
      : null;
  }

  if (
    typeof parsed.eventId === "string" &&
    typeof parsed.instanceId === "string" &&
    typeof parsed.type === "string" &&
    typeof parsed.key === "string"
  ) {
    return {
      kind: "delivery",
      frame: {
        eventId: parsed.eventId,
        instanceId: parsed.instanceId,
        type: parsed.type,
        key: parsed.key,
        value: parsed.value,
      },
    };
  }
  return null;
}

export class SceneEventSource {
  private readonly url: string;
  private readonly fetchFn: typeof fetch;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly coordinator: ReconnectCoordinator;
  private readonly random: () => number;

  private sink: SceneEventSink | null = null;
  private stopped = true;
  private everConnected = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;

  constructor(options: SceneEventSourceOptions) {
    this.url = options.url;
    // Must stay bound to the global. Stored on an instance and called
    // as `this.fetchFn(...)`, the browser's WebIDL receiver check sees
    // `this === SceneEventSource` and throws "Failed to execute 'fetch'
    // on 'Window': Illegal invocation" -- swallowed by connect()'s catch,
    // so the stream never opens and the banner sticks on Disconnected
    // with no request ever leaving the page. Bun's fetch is not
    // receiver-sensitive, which is why the unit tests pass regardless.
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.reconnectBaseMs = options.reconnectBaseMs ?? 500;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 5_000;
    this.coordinator = options.coordinator ?? ALWAYS_PROBE;
    this.random = options.random ?? Math.random;
  }

  start(sink: SceneEventSink): void {
    this.sink = sink;
    this.stopped = false;
    this.reconnectAttempt = 0;
    this.coordinator.onPeerConnected(() => {
      this.wakeNow();
    });
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
    this.abortController?.abort();
    this.abortController = null;
    this.coordinator.stop();
  }

  /** A sibling overlay reached the server, so ours is reachable too:
   *  abandon the remaining backoff and probe now. */
  private wakeNow(): void {
    if (this.stopped || this.reconnectTimer === null) {
      return;
    }
    this.clearTimer();
    this.reconnectAttempt = 0;
    void this.connect();
  }

  private async connect(): Promise<void> {
    if (this.stopped) {
      return;
    }
    const controller = new AbortController();
    this.abortController = controller;

    let response: Response;
    try {
      response = await this.fetchFn(this.url, {
        credentials: "same-origin",
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });
    } catch {
      if (!this.stopped) {
        this.onDisconnected();
        this.scheduleReconnect();
      }
      return;
    }

    if (!response.ok || !response.body) {
      // A rejected session is terminal for this page, not transient.
      // The session cookie is a 60s JWT (SESSION_TOKEN_TTL_SECONDS)
      // kept alive by a ~50s refresh, so any outage longer than a
      // minute expires it. Reconnecting then replays the *same* dead
      // cookie forever: the server 401s, we never receive a hello
      // frame, and the boot-id check that would have caught the
      // restart never runs. Only a page load can mint a new session
      // (the shell does it from the ?token= in the URL), so hand this
      // to the sink instead of retrying into a wall.
      if (SESSION_REJECTED_STATUSES.has(response.status) && this.everConnected) {
        this.onDisconnected();
        this.sink?.onSessionExpired?.();
        return;
      }
      this.onDisconnected();
      this.scheduleReconnect();
      return;
    }

    this.everConnected = true;

    this.reconnectAttempt = 0;
    this.coordinator.onConnected();
    this.sink?.onConnectionChange(true);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const parsed = parseSseChunk(rawEvent);
          if (!parsed) {
            continue;
          }
          if (parsed.kind === "hello") {
            this.sink?.onHello?.(parsed.bootId);
          } else {
            this.sink?.onFrame(parsed.frame);
          }
        }
      }
    } catch {
      // Stream errored (network drop, abort) -- fall through to reconnect.
    }

    if (this.stopped) {
      return;
    }
    this.onDisconnected();
    this.scheduleReconnect();
  }

  private onDisconnected(): void {
    this.coordinator.onDisconnected();
    this.sink?.onConnectionChange(false);
  }

  private clearTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** Equal jitter: half the capped delay, plus a random half. Spreads
   *  sibling overlays that dropped together without ever collapsing to
   *  a near-zero delay the way full jitter can. */
  private nextDelayMs(): number {
    const capped = Math.min(this.reconnectBaseMs * 2 ** this.reconnectAttempt, this.reconnectMaxMs);
    return capped / 2 + this.random() * (capped / 2);
  }

  private scheduleReconnect(): void {
    if (this.stopped) {
      return;
    }
    const delay = this.nextDelayMs();
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      // Another overlay is the elected prober this round. Don't probe;
      // re-arm and re-check. Its success reaches us via onPeerConnected
      // long before this timer would have mattered.
      if (!this.coordinator.shouldProbe()) {
        this.scheduleReconnect();
        return;
      }
      void this.connect();
    }, delay);
  }
}
