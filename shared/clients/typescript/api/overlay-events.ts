// P2 — `woofx3.overlay-events` v1: the scene-manager <-> event-source
// contract. Identical frames travel over either transport:
//
//   - WebSocket (default): streamware `/o/{token}/events`, reached
//     through the api proxy at `/overlay/{token}/events`.
//   - Parent frame (`?eventSource=parent`, Convex production mode):
//     the embedding page posts the same envelopes via postMessage
//     after the `attach.ready` / `attach.ack` handshake.
//
// Design reference:
//   docs/superpowers/specs/2026-06-12-streamware-overlay-architecture-design.md §2.4
//
// The `storage` and `event` frames mirror streamware's existing
// `StorageChangedPayload` / `WidgetEventPushPayload` wire shapes
// (streamware/src/storage-broadcaster.ts) so the scene manager's
// client-side routing is transport-agnostic. Unknown frame kinds are
// ignored by receivers; unsupported `v` closes the channel.

export const OVERLAY_EVENTS_PROTOCOL = "woofx3.overlay-events";
export type OverlayEventsProtocolName = typeof OVERLAY_EVENTS_PROTOCOL;

export const OVERLAY_EVENTS_VERSION = 1;
export type OverlayEventsProtocolVersion = typeof OVERLAY_EVENTS_VERSION;

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

/**
 * Module-storage change fan-out. Mirrors the engine's
 * `module.storage.changed` CloudEvent data plus the source moduleId;
 * scene managers route by `(moduleId, key)` to subscribed widgets.
 */
export interface OverlayStorageFrame {
  kind: "storage";
  /** Originating CloudEvent id, when known. */
  id?: string;
  moduleId: string;
  key: string;
  value: unknown;
  previousValue?: unknown;
  /** RFC3339 timestamp of the storage write. */
  occurredAt: string;
}

/**
 * Engine-side trigger event push. The scene manager matches `type`
 * against each widget's accepted events and delivers via P1
 * `event.deliver` — the typed shape is preserved end to end.
 */
export interface OverlayEventFrame {
  kind: "event";
  /** Originating CloudEvent id, when known. */
  id?: string;
  /** Canonical trigger id, e.g. `twitch_platform:trigger:follow.user.twitch`. */
  type: string;
  /** CloudEvent source. */
  source: string;
  /** RFC3339 timestamp. */
  time: string;
  /** Event payload — opaque at this boundary. */
  data: unknown;
  /** Workflow action `parameters` envelope when the event was raised
   *  via an alert-style action. Forwarded verbatim. */
  parameters?: Record<string, unknown>;
}

/**
 * Scene-config invalidation. On receipt the scene manager refetches
 * `./config`, diffs widget instances, and disposes/creates frames.
 * `revision` is monotonic per scene so stale notifications can be
 * dropped.
 */
export interface OverlaySceneUpdatedFrame {
  kind: "scene.updated";
  sceneId: string;
  revision: number;
}

/**
 * Channel control. `token.revoked`: the overlay's token died — the
 * server closes the socket after sending this; the page goes dark
 * rather than retrying. `reconnect`: the server asks the client to
 * drop and re-establish (e.g. ahead of a restart); on reconnect the
 * scene manager refetches `./config` and treats its caches as stale
 * (P2 delivery is explicitly not gapless — design §5.2.13).
 */
export interface OverlayControlFrame {
  kind: "control";
  action: "token.revoked" | "reconnect";
}

/**
 * Parent-mode handshake, step 1 (overlay -> embedder): the scene
 * manager announces it is ready to receive frames for `token`. Sent
 * only in `?eventSource=parent` mode.
 */
export interface OverlayAttachReadyFrame {
  kind: "attach.ready";
  token: string;
}

/**
 * Parent-mode handshake, step 2 (embedder -> overlay): the parent
 * acknowledges with the protocol version it will speak. After this
 * the scene manager accepts frames only from `event.source ===
 * window.parent` (design §5.2.10).
 */
export interface OverlayAttachAckFrame {
  kind: "attach.ack";
  v: number;
}

export type OverlayEventsFrame =
  | OverlayStorageFrame
  | OverlayEventFrame
  | OverlaySceneUpdatedFrame
  | OverlayControlFrame
  | OverlayAttachReadyFrame
  | OverlayAttachAckFrame;

export type OverlayEventsFrameKind = OverlayEventsFrame["kind"];

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface OverlayEventsEnvelope {
  proto: OverlayEventsProtocolName;
  v: OverlayEventsProtocolVersion;
  frame: OverlayEventsFrame;
}

export function makeOverlayEventsEnvelope(frame: OverlayEventsFrame): OverlayEventsEnvelope {
  return { proto: OVERLAY_EVENTS_PROTOCOL, v: OVERLAY_EVENTS_VERSION, frame };
}

const KNOWN_FRAME_KINDS: ReadonlySet<string> = new Set<OverlayEventsFrameKind>([
  "storage",
  "event",
  "scene.updated",
  "control",
  "attach.ready",
  "attach.ack",
]);

/**
 * Envelope guard for inbound wire data (JSON-parsed WebSocket text or
 * postMessage data). Validates proto / v and that `frame.kind` is a
 * known kind — receivers that want forward-tolerance for unknown
 * kinds should check the envelope fields themselves and skip the
 * kind check.
 */
export function isOverlayEventsEnvelope(value: unknown): value is OverlayEventsEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const env = value as Record<string, unknown>;
  if (env.proto !== OVERLAY_EVENTS_PROTOCOL || env.v !== OVERLAY_EVENTS_VERSION) {
    return false;
  }
  const frame = env.frame;
  if (typeof frame !== "object" || frame === null) {
    return false;
  }
  const kind = (frame as Record<string, unknown>).kind;
  return typeof kind === "string" && KNOWN_FRAME_KINDS.has(kind);
}
