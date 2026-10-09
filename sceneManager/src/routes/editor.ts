import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import type { Logger } from "@woofx3/common/runtime";
import type { SceneDocuments } from "../scene/scene-documents";
import type { SceneVersion } from "../scene/scene-host";
import type { SessionTokenService } from "../scene/session-token";

/** Largest message an editor may send: one submit's ops and their envelope. */
export const MAX_EDITOR_MESSAGE_BYTES = 128 * 1024;

/** What one editor tells the others about itself: who, and what it has selected. */
export interface EditorPresence {
  name: string;
  /** The placement id it has selected, or null. */
  selection: string | null;
}

export interface EditorSocketData {
  sceneId: string;
  unsubscribe: (() => void) | null;
  /** This connection's id among the scene's editors. */
  editorId: string;
  presence: EditorPresence | null;
}

const MAX_PRESENCE_NAME = 64;
const MAX_PLACEMENT_ID = 128;

/** A presence message's fields, or null when they are not valid. */
export function parsePresence(message: Record<string, unknown>): EditorPresence | null {
  const name = typeof message.name === "string" ? message.name.trim().slice(0, MAX_PRESENCE_NAME) : "";
  const selection = message.selection;
  if (
    selection !== null &&
    (typeof selection !== "string" || selection.length === 0 || selection.length > MAX_PLACEMENT_ID)
  ) {
    return null;
  }
  return { name, selection };
}

export interface EditorDeps {
  sessionTokens: SessionTokenService;
  sceneDocuments: SceneDocuments;
  logger: Logger;
}

/**
 * `GET /scene/{sceneId}/edit?token=…` — the scene editor's socket. The token
 * is an editor token for this scene (see `SessionTokenService.mintEditor`),
 * which only the api hands out, to a dashboard allowed to edit it; an
 * overlay's session never opens this.
 */
export async function handleEditorUpgrade(
  req: Request,
  server: Server<EditorSocketData>,
  sceneId: string,
  deps: EditorDeps
): Promise<Response | undefined> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const claims = await deps.sessionTokens.verifyEditor(token);
  if (!claims || claims.sceneId !== sceneId) {
    return new Response("unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const data: EditorSocketData = { sceneId, unsubscribe: null, editorId: crypto.randomUUID(), presence: null };
  if (server.upgrade(req, { data })) {
    return undefined;
  }
  return new Response("expected a websocket", { status: 426 });
}

function isVersion(value: unknown): value is SceneVersion {
  return value === "published" || value === "draft";
}

/** What an editor socket error answers: opening the socket, or one message the editor sent. */
export type EditorErrorFor = "open" | "submit" | "publish" | "discard" | "snapshot" | "presence";

export interface EditorError {
  type: "error";
  for: EditorErrorFor;
  reason: "not_found" | "failed";
  /** The failed submit's op id, so the editor can settle the op it is waiting on; only on a submit's error. */
  opId?: string | null;
  version?: SceneVersion;
}

/**
 * The error that answers a message which threw. It names the message, and a
 * submit's op id and version, so an editor with several messages in flight
 * knows which one failed.
 */
export function failedMessageError(message: Record<string, unknown>): EditorError {
  switch (message.type) {
    case "submit": {
      const error: EditorError = {
        type: "error",
        for: "submit",
        reason: "failed",
        opId: typeof message.opId === "string" ? message.opId : null,
      };
      if (isVersion(message.version)) {
        error.version = message.version;
      }
      return error;
    }
    case "publish":
    case "discard":
    case "snapshot":
    case "presence":
      return { type: "error", for: message.type, reason: "failed" };
    default:
      throw new Error(`no error reply for an editor message of type ${String(message.type)}`);
  }
}

/**
 * What the editor socket says, as JSON messages.
 *
 * From the editor:
 *   { type: "submit", version, base, opId, ops }   json0 ops made against `base`
 *   { type: "publish" } | { type: "discard" }
 *   { type: "snapshot", version }                   resync one version
 *   { type: "presence", name, selection }           who this editor is and what it has selected
 *
 * To the editor:
 *   { type: "snapshot", version, snapshot, hasDraft }   on open (both), and on request
 *   { type: "ops", version, seq, ops, meta, opId, hasDraft }
 *       every change to the scene; the submitting editor's own carry its opId
 *   { type: "ack", opId, version, seq } | { type: "reject", opId, version, error, detail }
 *       the answer to each submit, after its ops; a resync reject is followed
 *       by a fresh snapshot of that version
 *   { type: "published" | "discarded", hasDraft }
 *   { type: "presence", editorId, name, selection }  another editor's, on open and as it changes
 *   { type: "presence", editorId, left: true }       another editor closed the scene
 *   { type: "error", for: "open", reason: "not_found" }
 *       the scene does not exist; the socket closes with 4404
 *   { type: "error", for, reason: "failed", opId?, version? }
 *       the message of type `for` failed; a submit's carries its opId and
 *       version, and that submit gets no ack or reject
 *
 * Presence is relayed between the scene's editors as it is and kept nowhere:
 * it is who is looking at what right now, not part of the scene.
 */
export function editorSocketHandlers(deps: EditorDeps): WebSocketHandler<EditorSocketData> {
  const docs = deps.sceneDocuments;
  const send = (ws: ServerWebSocket<EditorSocketData>, message: unknown) => {
    ws.send(JSON.stringify(message));
  };
  /** Every open editor socket, by scene. */
  const editors = new Map<string, Set<ServerWebSocket<EditorSocketData>>>();
  const others = (ws: ServerWebSocket<EditorSocketData>) =>
    [...(editors.get(ws.data.sceneId) ?? [])].filter((other) => other !== ws);
  const sendSnapshot = async (ws: ServerWebSocket<EditorSocketData>, version: SceneVersion) => {
    const snapshot = await docs.snapshot(ws.data.sceneId, version);
    send(ws, { type: "snapshot", version, snapshot, hasDraft: docs.hasDraft(ws.data.sceneId) });
  };

  return {
    maxPayloadLength: MAX_EDITOR_MESSAGE_BYTES,
    async open(ws) {
      const { sceneId } = ws.data;
      const unsubscribe = await docs.subscribeEditor(sceneId, (event) => {
        send(ws, { type: "ops", ...event, hasDraft: docs.hasDraft(sceneId) });
      });
      if (!unsubscribe) {
        const notFound: EditorError = { type: "error", for: "open", reason: "not_found" };
        send(ws, notFound);
        ws.close(4404, "scene not found");
        return;
      }
      ws.data.unsubscribe = unsubscribe;
      await sendSnapshot(ws, "published");
      await sendSnapshot(ws, "draft");
      let sceneEditors = editors.get(sceneId);
      if (!sceneEditors) {
        sceneEditors = new Set();
        editors.set(sceneId, sceneEditors);
      }
      sceneEditors.add(ws);
      for (const other of others(ws)) {
        if (other.data.presence) {
          send(ws, { type: "presence", editorId: other.data.editorId, ...other.data.presence });
        }
      }
    },
    async message(ws, raw) {
      let message: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
        if (typeof parsed !== "object" || parsed === null) {
          return;
        }
        message = parsed as Record<string, unknown>;
      } catch {
        return;
      }
      const { sceneId } = ws.data;
      try {
        switch (message.type) {
          case "submit": {
            const opId = typeof message.opId === "string" ? message.opId : null;
            const version = message.version;
            if (!isVersion(version) || typeof message.base !== "number") {
              send(ws, { type: "reject", opId, version, error: "invalid", detail: "submit needs a version and base" });
              return;
            }
            const result = await docs.submit(sceneId, version, message.base, message.ops, opId);
            if (result.ok) {
              send(ws, { type: "ack", opId, version, seq: result.seq });
            } else {
              send(ws, { type: "reject", opId, version, error: result.error, detail: result.detail ?? null });
              if (result.error === "resync") {
                await sendSnapshot(ws, version);
              }
            }
            return;
          }
          case "publish":
            await docs.publish(sceneId);
            send(ws, { type: "published", hasDraft: docs.hasDraft(sceneId) });
            return;
          case "discard":
            await docs.discard(sceneId);
            send(ws, { type: "discarded", hasDraft: docs.hasDraft(sceneId) });
            return;
          case "snapshot":
            if (isVersion(message.version)) {
              await sendSnapshot(ws, message.version);
            }
            return;
          case "presence": {
            const presence = parsePresence(message);
            if (!presence) {
              return;
            }
            ws.data.presence = presence;
            for (const other of others(ws)) {
              send(other, { type: "presence", editorId: ws.data.editorId, ...presence });
            }
            return;
          }
          default:
            return;
        }
      } catch (err) {
        deps.logger.warn("scene editor: a message failed", {
          sceneId,
          type: String(message.type),
          error: err instanceof Error ? err.message : String(err),
        });
        send(ws, failedMessageError(message));
      }
    },
    close(ws) {
      ws.data.unsubscribe?.();
      ws.data.unsubscribe = null;
      const sceneEditors = editors.get(ws.data.sceneId);
      if (sceneEditors?.delete(ws)) {
        for (const other of sceneEditors) {
          send(other, { type: "presence", editorId: ws.data.editorId, left: true });
        }
        if (sceneEditors.size === 0) {
          editors.delete(ws.data.sceneId);
        }
      }
    },
  };
}
