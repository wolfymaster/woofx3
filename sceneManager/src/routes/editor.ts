import {
  MAX_ITEM_BYTES,
  PROTOCOL_VERSION,
  parseClientMessage,
  SESSION_ERROR_CLOSE_CODES,
  type SessionErrorCode,
} from "@woofx3/api/scene-editor";
import type { Logger } from "@woofx3/common/runtime";
import type { Server, ServerWebSocket, WebSocketHandler } from "bun";
import type { EditorConnection, SceneDocuments } from "../scene/scene-documents";
import type { SessionTokenService } from "../scene/session-token";

/** Largest message an editor may send: the largest item the sequencer takes, and its envelope. */
export const MAX_EDITOR_MESSAGE_BYTES = MAX_ITEM_BYTES + 64 * 1024;

export interface EditorSocketData {
  sceneId: string;
  /** Set by the socket's hello; null until then. */
  clientId: string | null;
  /** How the scene documents reach this socket; made once, so it identifies the socket to them. */
  conn: EditorConnection | null;
}

export interface EditorDeps {
  sessionTokens: SessionTokenService;
  sceneDocuments: SceneDocuments;
  logger: Logger;
}

/** The socket data for a new editor socket on `sceneId`. */
export function editorSocketData(sceneId: string): EditorSocketData {
  return { sceneId, clientId: null, conn: null };
}

/**
 * `GET /scene/{sceneId}/edit?token=…&protocol=2` — the scene editor's socket.
 * The token is an editor token for this scene (see
 * `SessionTokenService.mintEditor`), which only the api hands out, to a
 * dashboard allowed to edit it; an overlay's session never opens this. A
 * client that does not ask for protocol 2 is answered 426: this engine
 * speaks no other.
 */
export async function handleEditorUpgrade(
  req: Request,
  server: Server<EditorSocketData>,
  sceneId: string,
  deps: EditorDeps
): Promise<Response | undefined> {
  const params = new URL(req.url).searchParams;
  const claims = await deps.sessionTokens.verifyEditor(params.get("token") ?? "");
  if (!claims || claims.sceneId !== sceneId) {
    return new Response("unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (params.get("protocol") !== String(PROTOCOL_VERSION)) {
    return new Response(`the scene editor speaks protocol ${PROTOCOL_VERSION}`, {
      status: 426,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (server.upgrade(req, { data: editorSocketData(sceneId) })) {
    return undefined;
  }
  return new Response("expected a websocket", { status: 426 });
}

/**
 * The editor socket, protocol 2 (`@woofx3/api/scene-editor/protocol`).
 *
 * The first message is `hello`; then `item` and `presence`. Every message is
 * handed to the scene documents synchronously as it arrives, where it joins
 * the scene's serial queue, so a socket's messages are decided in the order
 * they were sent and every reply goes out in commit order. Presence is
 * keyed by the client's id and relayed between the scene's editors; it is
 * kept nowhere.
 */
export function editorSocketHandlers(deps: EditorDeps): WebSocketHandler<EditorSocketData> {
  const docs = deps.sceneDocuments;
  const settle = (sceneId: string, what: string) => (err: unknown) => {
    deps.logger.warn("scene editor: handling a message failed", {
      sceneId,
      message: what,
      error: err instanceof Error ? err.message : String(err),
    });
  };

  return {
    maxPayloadLength: MAX_EDITOR_MESSAGE_BYTES,
    message(ws, raw) {
      const { sceneId } = ws.data;
      const value = parseJson(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
      if (isOtherProtocolHello(value)) {
        sessionError(ws, "unsupported_protocol", `this engine speaks scene editor protocol ${PROTOCOL_VERSION}`);
        return;
      }
      const message = parseClientMessage(value);
      if (message === null) {
        sessionError(ws, "protocol", "not a protocol 2 message");
        return;
      }
      if (ws.data.clientId === null || ws.data.conn === null) {
        if (message.type !== "hello") {
          sessionError(ws, "protocol", "the first message must be hello");
          return;
        }
        const conn = connectionOf(ws);
        ws.data.clientId = message.clientId;
        ws.data.conn = conn;
        docs
          .openEditor(sceneId, { clientId: message.clientId, have: message.have, name: message.name }, conn)
          .catch(settle(sceneId, "hello"));
        return;
      }
      const { clientId, conn } = ws.data;
      switch (message.type) {
        case "hello": {
          sessionError(ws, "protocol", "hello was already sent");
          return;
        }
        case "item": {
          docs
            .submitItem(sceneId, clientId, message.seq, message.base, message.body, (reply) => {
              if (reply.type === "error") {
                sessionError(ws, reply.code, reply.detail);
              } else {
                conn.send(reply);
              }
            })
            .catch(settle(sceneId, "item"));
          return;
        }
        case "presence": {
          const update =
            "away" in message ? { away: true as const } : { selection: message.selection, version: message.version };
          docs.editorPresence(sceneId, clientId, conn, update).catch(settle(sceneId, "presence"));
          return;
        }
      }
    },
    close(ws) {
      const { sceneId, clientId, conn } = ws.data;
      if (clientId !== null && conn !== null) {
        docs.closeEditor(sceneId, clientId, conn).catch(settle(sceneId, "close"));
      }
    },
  };
}

function connectionOf(ws: ServerWebSocket<EditorSocketData>): EditorConnection {
  return {
    send: (message) => {
      ws.send(JSON.stringify(message));
    },
    close: (code, reason) => {
      ws.close(code, reason);
    },
  };
}

function sessionError(ws: ServerWebSocket<EditorSocketData>, code: SessionErrorCode, detail: string): void {
  ws.send(JSON.stringify({ type: "error", code, detail }));
  ws.close(SESSION_ERROR_CLOSE_CODES[code], detail.slice(0, 100));
}

/** A hello naming a protocol other than this one, which deserves its own error rather than a parse failure. */
function isOtherProtocolHello(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "hello" &&
    (value as { protocol?: unknown }).protocol !== PROTOCOL_VERSION
  );
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
