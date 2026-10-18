// The wire between the scene manager and an overlay page: the server-sent
// event stream the page reads (`GET /scene/{sceneId}/events`), and the
// acknowledgements it posts back (`POST /scene/{sceneId}/events/{eventId}/
// {delivered|started|completed}`). Both ends build and read these shapes
// through this module only, so a change to one cannot leave the other
// reading something else.

import { type SceneOpsEvent, parseSceneOpsEvent } from "@woofx3/api/scene-editor/document";

/** One event addressed to one placement: an open delivery. */
export interface DeliveryFrame {
  eventId: string;
  instanceId: string;
  type: string;
  key: string;
  value: unknown;
}

/** A change to a module storage key some widget on the page reads. */
export interface ModuleStateFrame {
  moduleId: string;
  key: string;
  value: unknown;
}

/** Deliveries to one placement the server closed before they finished (a skip or clear). */
export interface CancelFrame {
  instanceId: string;
  eventIds: string[];
}

/**
 * Every frame the stream carries:
 * - `hello` opens every stream: the server process's boot id, so a page can
 *   tell a restart from a resumed stream, and the sequence each version of
 *   the scene is at, so a page that missed ops resyncs.
 * - `delivery`, `module-state`, `scene-ops` and `cancel` as their types say.
 */
export type StreamFrame =
  | { kind: "hello"; bootId: string; seq: number; draftSeq: number }
  | { kind: "delivery"; frame: DeliveryFrame }
  | { kind: "module-state"; frame: ModuleStateFrame }
  | { kind: "scene-ops"; event: SceneOpsEvent }
  | { kind: "cancel"; frame: CancelFrame };

/** A comment line: keeps an idle stream from being reaped, and is read as nothing. */
export const KEEPALIVE_FRAME = ": keepalive\n\n";

/** `frame` as one server-sent event. */
export function encodeStreamFrame(frame: StreamFrame): string {
  return `event: ${frame.kind}\ndata: ${JSON.stringify(dataOf(frame))}\n\n`;
}

function dataOf(frame: StreamFrame): unknown {
  switch (frame.kind) {
    case "hello":
      return { bootId: frame.bootId, seq: frame.seq, draftSeq: frame.draftSeq };
    case "scene-ops":
      return frame.event;
    default:
      return frame.frame;
  }
}

/** One server-sent event read back, or null for a comment or anything malformed. */
export function parseStreamFrame(rawEvent: string): StreamFrame | null {
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

  switch (eventName) {
    case "hello":
      return typeof parsed.bootId === "string" && parsed.bootId.length > 0
        ? {
            kind: "hello",
            bootId: parsed.bootId,
            seq: typeof parsed.seq === "number" ? parsed.seq : 0,
            draftSeq: typeof parsed.draftSeq === "number" ? parsed.draftSeq : 0,
          }
        : null;
    case "scene-ops": {
      const event = parseSceneOpsEvent(parsed);
      return event ? { kind: "scene-ops", event } : null;
    }
    case "cancel": {
      const { instanceId, eventIds } = parsed;
      return typeof instanceId === "string" &&
        Array.isArray(eventIds) &&
        eventIds.every((id): id is string => typeof id === "string")
        ? { kind: "cancel", frame: { instanceId, eventIds } }
        : null;
    }
    case "module-state":
      return typeof parsed.moduleId === "string" && typeof parsed.key === "string"
        ? { kind: "module-state", frame: { moduleId: parsed.moduleId, key: parsed.key, value: parsed.value ?? null } }
        : null;
    case "delivery":
      return typeof parsed.eventId === "string" &&
        typeof parsed.instanceId === "string" &&
        typeof parsed.type === "string" &&
        typeof parsed.key === "string"
        ? {
            kind: "delivery",
            frame: {
              eventId: parsed.eventId,
              instanceId: parsed.instanceId,
              type: parsed.type,
              key: parsed.key,
              value: parsed.value,
            },
          }
        : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Acknowledgements

/**
 * - `delivered`: the event reached the placement's queue on the page.
 * - `started`: an alert widget began playing it (alerts only).
 * - `completed`: the widget finished it, or the page gave up on it.
 */
export type AckKind = "delivered" | "started" | "completed";

export const ACK_KINDS: readonly AckKind[] = ["delivered", "started", "completed"];

/** Where a page posts an ack: `sceneBase` is the scene's path, `/scene/{sceneId}`. */
export function ackPath(sceneBase: string, eventId: string, kind: AckKind): string {
  return `${sceneBase}/events/${encodeURIComponent(eventId)}/${kind}`;
}

/** An ack's body: the placements of one event it acknowledges. */
export function encodeAckBody(instanceIds: readonly string[]): string {
  return JSON.stringify({ instanceIds });
}

/** The placements an ack's parsed JSON body names, or null when it names none or is malformed. */
export function parseAckBody(body: unknown): string[] | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const instanceIds = (body as { instanceIds?: unknown }).instanceIds;
  if (!Array.isArray(instanceIds) || instanceIds.length === 0) {
    return null;
  }
  return instanceIds.every((id): id is string => typeof id === "string" && id.length > 0) ? instanceIds : null;
}

/**
 * The server's answer to an ack it could not wholly record (503): the
 * placements it could not, which the page sends again. Acks are
 * idempotent, so resending what did land is harmless.
 */
export interface AckRefusal {
  error: "unavailable";
  instanceIds: string[];
}
