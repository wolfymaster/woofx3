// P2 — `woofx3.overlay-events` v1 transports for the scene manager.
// Two implementations of `SceneEventSource` carry identical frames:
//
//   - `WebSocketEventSource` (default): relative `./events` derived
//     from the page URL — works through the api proxy, a Convex
//     proxy, or tunnels unchanged.
//   - `ParentFrameEventSource` (`?eventSource=parent`): the embedding
//     page posts the same envelopes via postMessage after the
//     `attach.ready` / `attach.ack` handshake. After ack, frames are
//     accepted ONLY from `event.source === window.parent`
//     (design §5.2.10).
//
// Design reference:
//   docs/superpowers/specs/2026-06-12-streamware-overlay-architecture-design.md §2.4
//
// Upstream messages are raw `OverlayWidgetEvent` JSON on the WS path
// (the wire shape streamware/src/widget-event-wire.ts decodes) and a
// `{ kind: "widget.event", event }` P2 frame on the parent path.

import type { WidgetEvent, WidgetStatusReport } from "@woofx3/module-sdk";
import {
  OVERLAY_EVENTS_PROTOCOL,
  OVERLAY_EVENTS_VERSION,
  isOverlayEventsEnvelope,
  type OverlayEventFrame,
  type OverlayEventsFrame,
} from "../../../../shared/clients/typescript/api/overlay-events";

/** Frames + lifecycle signals the scene manager consumes. */
export interface SceneEventSink {
  onFrame(frame: OverlayEventsFrame): void;
  /** Fired when the transport re-establishes after having been
   *  connected before. The scene manager refetches `./config` and
   *  treats its storage cache as stale (design §5.2.13). */
  onReconnected(): void;
  onConnectionChange?(connected: boolean): void;
}

export interface SceneEventSource {
  start(sink: SceneEventSink): void;
  /** Best-effort upstream send. Dropped (with a console warning) when
   *  the transport is not ready. Never throws. */
  send(event: WidgetStatusReport): void;
  stop(): void;
}

/** Parse one inbound P2 envelope from the wire (WS text or postMessage
 *  data already JSON-parsed). Only properly-enveloped P2 frames are
 *  accepted; anything else is dropped with a debug log. */
export function parseInboundFrame(payload: unknown): OverlayEventsFrame | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  if (isOverlayEventsEnvelope(payload)) {
    return payload.frame;
  }
  const record = payload as Record<string, unknown>;
  if (record.proto === OVERLAY_EVENTS_PROTOCOL) {
    console.warn("[overlay:events] dropping unrecognized overlay-events envelope", { v: record.v });
    return null;
  }
  console.debug("[overlay:events] dropping non-envelope message", { kind: record.kind });
  return null;
}

// ---------------------------------------------------------------------------
// WebSocket transport
// ---------------------------------------------------------------------------

/** Derive the absolute WS URL for the relative `./events` endpoint. */
export function resolveEventsWsUrl(href: string): string {
  const url = new URL("./events", href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** Injectable WebSocket surface so transports are testable without a
 *  network. Matches the browser WebSocket property-handler API. */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
}

const WS_OPEN = 1;

export interface WebSocketEventSourceOptions {
  /** Absolute WS URL. Defaults to `./events` relative to the page. */
  url?: string;
  wsFactory?: (url: string) => WebSocketLike;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

export class WebSocketEventSource implements SceneEventSource {
  private readonly url: string;
  private readonly wsFactory: (url: string) => WebSocketLike;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;

  private sink: SceneEventSink | null = null;
  private ws: WebSocketLike | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private hasConnectedOnce = false;
  private stopped = true;

  constructor(options: WebSocketEventSourceOptions = {}) {
    this.url = options.url ?? resolveEventsWsUrl(location.href);
    this.wsFactory = options.wsFactory ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike);
    this.reconnectBaseMs = options.reconnectBaseMs ?? 500;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 10_000;
  }

  start(sink: SceneEventSink): void {
    this.sink = sink;
    this.stopped = false;
    this.reconnectAttempt = 0;
    this.connect();
  }

  send(event: WidgetStatusReport): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) {
      console.warn("[overlay:events] upstream send dropped — socket not open", {
        moduleId: event.moduleId,
        instanceId: event.instanceId,
        key: event.key,
      });
      return;
    }
    try {
      ws.send(JSON.stringify(event));
    } catch (err) {
      console.error("[overlay:events] upstream send failed", { error: err });
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  }

  private connect(): void {
    if (this.stopped) {
      return;
    }
    const ws = this.wsFactory(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      const reconnected = this.hasConnectedOnce;
      this.hasConnectedOnce = true;
      this.sink?.onConnectionChange?.(true);
      if (reconnected) {
        this.sink?.onReconnected();
      }
    };

    ws.onmessage = (msg) => {
      let payload: unknown;
      try {
        payload = JSON.parse(msg.data as string);
      } catch (err) {
        console.error("[overlay:events] payload parse failed", err, msg.data);
        return;
      }
      const frame = parseInboundFrame(payload);
      if (frame !== null) {
        this.sink?.onFrame(frame);
      }
    };

    ws.onclose = () => {
      this.ws = null;
      this.sink?.onConnectionChange?.(false);
      this.scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.error("[overlay:events] socket error", err);
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) {
      return;
    }
    const attempt = this.reconnectAttempt;
    this.reconnectAttempt += 1;
    const delay = Math.min(this.reconnectBaseMs * Math.pow(2, attempt), this.reconnectMaxMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

// ---------------------------------------------------------------------------
// Parent-frame transport (?eventSource=parent)
// ---------------------------------------------------------------------------

/** Upstream P2 frame the overlay posts to the embedding parent. Not in
 *  the downstream `OverlayEventsFrame` union — the parent forwards it
 *  to the api `reportWidgetEvent` RPC (design §2.4). */
export interface OverlayUpstreamWidgetEventFrame {
  kind: "widget.event";
  event: WidgetStatusReport;
}

interface ParentPort {
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface ParentWindowLike {
  parent?: unknown;
  addEventListener(type: "message", listener: (event: { source: unknown; data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { source: unknown; data: unknown }) => void): void;
}

export interface ParentFrameEventSourceOptions {
  token: string;
  /** Defaults to the global `window`. */
  windowRef?: ParentWindowLike;
  /** `attach.ready` re-post cadence until the parent acks. */
  readyRetryMs?: number;
}

export class ParentFrameEventSource implements SceneEventSource {
  private readonly token: string;
  private readonly windowRef: ParentWindowLike;
  private readonly parentRef: ParentPort | null;
  private readonly readyRetryMs: number;

  private sink: SceneEventSink | null = null;
  private acked = false;
  private hasAckedOnce = false;
  private readyTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onMessage = (event: { source: unknown; data: unknown }): void => {
    this.handleMessage(event);
  };

  constructor(options: ParentFrameEventSourceOptions) {
    this.token = options.token;
    this.windowRef = options.windowRef ?? (window as unknown as ParentWindowLike);
    this.readyRetryMs = options.readyRetryMs ?? 500;
    const parentCandidate = this.windowRef.parent;
    this.parentRef =
      parentCandidate && typeof (parentCandidate as ParentPort).postMessage === "function"
        ? (parentCandidate as ParentPort)
        : null;
  }

  start(sink: SceneEventSink): void {
    this.sink = sink;
    if (this.parentRef === null) {
      console.error("[overlay:events] parent event source requires an embedding parent window");
      return;
    }
    this.windowRef.addEventListener("message", this.onMessage);
    this.postReady();
    this.readyTimer = setInterval(() => {
      if (!this.acked) {
        this.postReady();
      }
    }, this.readyRetryMs);
  }

  send(event: WidgetStatusReport): void {
    if (this.parentRef === null || !this.acked) {
      console.warn("[overlay:events] upstream send dropped — parent channel not attached", {
        moduleId: event.moduleId,
        instanceId: event.instanceId,
        key: event.key,
      });
      return;
    }
    const frame: OverlayUpstreamWidgetEventFrame = { kind: "widget.event", event };
    this.parentRef.postMessage(
      { proto: OVERLAY_EVENTS_PROTOCOL, v: OVERLAY_EVENTS_VERSION, frame },
      "*",
    );
  }

  stop(): void {
    if (this.readyTimer !== null) {
      clearInterval(this.readyTimer);
      this.readyTimer = null;
    }
    this.windowRef.removeEventListener("message", this.onMessage);
    this.acked = false;
    this.sink = null;
  }

  private postReady(): void {
    this.parentRef?.postMessage(
      {
        proto: OVERLAY_EVENTS_PROTOCOL,
        v: OVERLAY_EVENTS_VERSION,
        frame: { kind: "attach.ready", token: this.token },
      },
      "*",
    );
  }

  private handleMessage(event: { source: unknown; data: unknown }): void {
    // Source identity check applies to every inbound message,
    // including the ack itself (design §5.2.10).
    if (this.parentRef === null || event.source !== this.parentRef) {
      return;
    }
    if (!isOverlayEventsEnvelope(event.data)) {
      return;
    }
    const frame = event.data.frame;
    if (frame.kind === "attach.ack") {
      const reattached = this.hasAckedOnce && !this.acked;
      this.acked = true;
      this.hasAckedOnce = true;
      this.sink?.onConnectionChange?.(true);
      if (reattached) {
        this.sink?.onReconnected();
      }
      return;
    }
    if (frame.kind === "attach.ready") {
      return;
    }
    if (!this.acked) {
      return;
    }
    this.sink?.onFrame(frame);
  }
}

/** Convert a P2 event frame into the typed `WidgetEvent` delivered to
 *  widgets — the shape is preserved end to end. */
export function widgetEventFromFrame(frame: OverlayEventFrame): WidgetEvent {
  return {
    type: frame.type,
    source: frame.source,
    time: frame.time,
    data: frame.data,
    ...(frame.parameters !== undefined ? { parameters: frame.parameters } : {}),
  };
}
