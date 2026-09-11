// Cross-overlay reconnect gossip. A scene is typically several OBS
// browser sources on one origin, all pointed at the same sceneManager.
// Left alone, every one of them runs its own independent backoff loop:
// N sources means N times the probe rate while the server is down, and
// each source discovers the server's return on its own schedule, so
// they un-blank at staggered times.
//
// BroadcastChannel is same-origin and purely in-browser, so this costs
// nothing on the wire. Two jobs:
//
//   1. Announce success. Whichever instance reconnects first tells the
//      rest, and they reconnect immediately instead of sitting out the
//      remainder of their own backoff.
//   2. Elect one prober. While disconnected, instances heartbeat their
//      peer ids; only the lowest id actually probes. If that page goes
//      away its heartbeats stop, and the next-lowest takes over once
//      the entry ages out.
//
// Election fails OPEN in every direction that matters: no
// BroadcastChannel, no peers heard yet, or a leader that vanished all
// resolve to "probe anyway". The worst case is the uncoordinated
// behavior we already had, never a scene that stops trying.

/** Consulted by `SceneEventSource` before each probe. */
export interface ReconnectCoordinator {
  /** Whether this instance should run the next connection probe. */
  shouldProbe(): boolean;
  /** This instance lost (or failed to open) the stream. */
  onDisconnected(): void;
  /** This instance has an open stream. */
  onConnected(): void;
  /** Invoked when a peer reports the server is reachable again. */
  onPeerConnected(handler: () => void): void;
  /** Tell every sibling overlay to reload itself.
   *
   *  This is the fallback for when sceneManager cannot reach the
   *  overlays itself -- no obs-websocket connection, or an overlay
   *  open somewhere OBS doesn't know about. The server has no channel
   *  to a browser it isn't already connected to, but a *sibling tab
   *  does*: BroadcastChannel is same-origin browser IPC and needs no
   *  network at all. So the first overlay to notice the server
   *  restarted relays that to the rest, including siblings whose own
   *  session has expired and which could never have learned it from
   *  the server on their own. */
  requestPeerReload(): void;
  /** Invoked when a peer asks this overlay to reload. */
  onPeerReload(handler: () => void): void;
  stop(): void;
}

/** Fail-open coordinator: every instance probes on its own schedule.
 *  Used when BroadcastChannel is unavailable, and as the default when
 *  no coordinator is injected. */
export const ALWAYS_PROBE: ReconnectCoordinator = {
  shouldProbe: () => true,
  onDisconnected: () => {},
  onConnected: () => {},
  onPeerConnected: () => {},
  requestPeerReload: () => {},
  onPeerReload: () => {},
  stop: () => {},
};

const HEARTBEAT_MS = 2_000;
// Must exceed HEARTBEAT_MS by enough that one dropped/delayed beat
// doesn't unseat a healthy leader, but stay short enough that a closed
// browser source hands off in seconds rather than tens of seconds.
const PEER_TTL_MS = 5_500;

const CHANNEL_NAME = "woofx3-scene-manager-reconnect";

type CoordinatorMessage = { t: "alive"; id: string } | { t: "up" } | { t: "reload" };

/** Minimal structural view of BroadcastChannel so tests can drive the
 *  coordinator without a real one. */
export interface BroadcastLike {
  postMessage(message: unknown): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export interface BroadcastCoordinatorOptions {
  channel: BroadcastLike;
  /** This instance's identity. Lowest id among live peers probes. */
  peerId?: string;
  now?: () => number;
  heartbeatMs?: number;
  peerTtlMs?: number;
}

function randomPeerId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class BroadcastReconnectCoordinator implements ReconnectCoordinator {
  private readonly channel: BroadcastLike;
  private readonly peerId: string;
  private readonly now: () => number;
  private readonly heartbeatMs: number;
  private readonly peerTtlMs: number;

  private readonly peersLastSeen = new Map<string, number>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private peerConnectedHandler: (() => void) | null = null;
  private peerReloadHandler: (() => void) | null = null;
  private stopped = false;

  constructor(options: BroadcastCoordinatorOptions) {
    this.channel = options.channel;
    this.peerId = options.peerId ?? randomPeerId();
    this.now = options.now ?? (() => Date.now());
    this.heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
    this.peerTtlMs = options.peerTtlMs ?? PEER_TTL_MS;
    this.channel.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  private handleMessage(data: unknown): void {
    const message = data as CoordinatorMessage | null;
    if (!message || typeof message !== "object") {
      return;
    }
    if (message.t === "alive" && typeof message.id === "string") {
      this.peersLastSeen.set(message.id, this.now());
      return;
    }
    if (message.t === "up") {
      this.peerConnectedHandler?.();
      return;
    }
    if (message.t === "reload") {
      this.peerReloadHandler?.();
    }
  }

  shouldProbe(): boolean {
    if (this.stopped) {
      return false;
    }
    const cutoff = this.now() - this.peerTtlMs;
    for (const [id, lastSeen] of this.peersLastSeen) {
      if (lastSeen < cutoff) {
        this.peersLastSeen.delete(id);
      }
    }
    // No live peers heard: we are the only candidate, so probe.
    for (const id of this.peersLastSeen.keys()) {
      if (id < this.peerId) {
        return false;
      }
    }
    return true;
  }

  onDisconnected(): void {
    if (this.stopped || this.heartbeatTimer !== null) {
      return;
    }
    // Announce immediately as well as on the interval: a peer that
    // drops at the same moment we do should see us within one tick,
    // not one full heartbeat later.
    this.announceAlive();
    this.heartbeatTimer = setInterval(() => {
      this.announceAlive();
    }, this.heartbeatMs);
  }

  onConnected(): void {
    this.stopHeartbeat();
    this.post({ t: "up" });
  }

  onPeerConnected(handler: () => void): void {
    this.peerConnectedHandler = handler;
  }

  requestPeerReload(): void {
    // Only the overlay that detected the restart broadcasts. Receivers
    // reload without rebroadcasting, so this can't turn into a storm.
    this.post({ t: "reload" });
  }

  onPeerReload(handler: () => void): void {
    this.peerReloadHandler = handler;
  }

  stop(): void {
    this.stopped = true;
    this.stopHeartbeat();
    this.peerConnectedHandler = null;
    this.peerReloadHandler = null;
    this.channel.onmessage = null;
    this.channel.close();
  }

  private announceAlive(): void {
    this.post({ t: "alive", id: this.peerId });
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private post(message: CoordinatorMessage): void {
    try {
      this.channel.postMessage(message);
    } catch {
      // A closed/erroring channel must never take the reconnect loop
      // down with it -- shouldProbe() stays fail-open regardless.
    }
  }
}

/** Adapts a real BroadcastChannel to `BroadcastLike`. Not a structural
 *  match: BroadcastChannel's `onmessage` takes a full `MessageEvent`,
 *  and under `strictFunctionTypes` that slot won't accept a handler
 *  typed for the `{ data }` shape the coordinator (and its tests)
 *  actually need. Narrowing here keeps the wider DOM type out of the
 *  coordinator entirely. */
function adaptBroadcastChannel(channel: BroadcastChannel): BroadcastLike {
  let handler: ((event: { data: unknown }) => void) | null = null;
  return {
    postMessage: (message: unknown) => channel.postMessage(message),
    close: () => channel.close(),
    get onmessage() {
      return handler;
    },
    set onmessage(next: ((event: { data: unknown }) => void) | null) {
      handler = next;
      channel.onmessage = next ? (event: MessageEvent) => next({ data: event.data }) : null;
    },
  };
}

/** Builds the real coordinator when the browser supports
 *  BroadcastChannel, otherwise the fail-open one. */
export function createReconnectCoordinator(): ReconnectCoordinator {
  if (typeof BroadcastChannel === "undefined") {
    return ALWAYS_PROBE;
  }
  try {
    return new BroadcastReconnectCoordinator({ channel: adaptBroadcastChannel(new BroadcastChannel(CHANNEL_NAME)) });
  } catch {
    return ALWAYS_PROBE;
  }
}
