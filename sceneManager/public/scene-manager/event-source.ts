// SSE client for `/scene/{sceneId}/events`, with a hand-written
// reconnect/backoff loop — ported in spirit (same exponential-backoff
// shape) from streamware/ui/src/lib/eventSource.ts's
// `WebSocketEventSource`. Deliberately NOT the native browser
// `EventSource` (whose reconnect cadence isn't fully controllable —
// see the design note in the plan about not depending on data-star's
// or the browser's own opaque reconnect timing) and NOT dependent on
// data-star's own SSE plugin: this is the thing that flips the
// `$connected` signal data-star's `data-show`/`data-class` react to,
// not something built on top of data-star's transport.

export interface DeliveryFrame {
  eventId: string;
  instanceId: string;
  type: string;
  key: string;
  value: unknown;
}

export interface SceneEventSink {
  onFrame(frame: DeliveryFrame): void;
  onConnectionChange(connected: boolean): void;
}

export interface SceneEventSourceOptions {
  url: string;
  fetchFn?: typeof fetch;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

/** Parses one `data: {...}` SSE line into a `DeliveryFrame`, or `null`
 *  for comment/keepalive lines and malformed payloads. */
export function parseSseChunk(rawEvent: string): DeliveryFrame | null {
  const dataLine = rawEvent
    .split("\n")
    .find((line) => line.startsWith("data:"));
  if (!dataLine) {
    return null;
  }
  const json = dataLine.slice("data:".length).trim();
  if (!json) {
    return null;
  }
  try {
    const parsed = JSON.parse(json) as Partial<DeliveryFrame>;
    if (
      typeof parsed.eventId === "string" &&
      typeof parsed.instanceId === "string" &&
      typeof parsed.type === "string" &&
      typeof parsed.key === "string"
    ) {
      return { eventId: parsed.eventId, instanceId: parsed.instanceId, type: parsed.type, key: parsed.key, value: parsed.value };
    }
  } catch {
    // fall through
  }
  return null;
}

export class SceneEventSource {
  private readonly url: string;
  private readonly fetchFn: typeof fetch;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;

  private sink: SceneEventSink | null = null;
  private stopped = true;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;

  constructor(options: SceneEventSourceOptions) {
    this.url = options.url;
    this.fetchFn = options.fetchFn ?? fetch;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 500;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 10_000;
  }

  start(sink: SceneEventSink): void {
    this.sink = sink;
    this.stopped = false;
    this.reconnectAttempt = 0;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.abortController?.abort();
    this.abortController = null;
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
    } catch (err) {
      if (!this.stopped) {
        this.onDisconnected();
        this.scheduleReconnect();
      }
      return;
    }

    if (!response.ok || !response.body) {
      this.onDisconnected();
      this.scheduleReconnect();
      return;
    }

    this.reconnectAttempt = 0;
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
          const frame = parseSseChunk(rawEvent);
          if (frame) {
            this.sink?.onFrame(frame);
          }
        }
      }
    } catch {
      // Stream errored (network drop, abort) — fall through to reconnect.
    }

    if (this.stopped) {
      return;
    }
    this.onDisconnected();
    this.scheduleReconnect();
  }

  private onDisconnected(): void {
    this.sink?.onConnectionChange(false);
  }

  private scheduleReconnect(): void {
    if (this.stopped) {
      return;
    }
    const attempt = this.reconnectAttempt;
    this.reconnectAttempt += 1;
    const delay = Math.min(this.reconnectBaseMs * 2 ** attempt, this.reconnectMaxMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }
}
