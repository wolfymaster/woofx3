// A fake obs-websocket v5 server for tests: just enough of the protocol for
// `openObsSession` to connect, sign in and load scenes.
//
// Protocol notes (obs-websocket 5.x, JSON encoding):
// - The client must offer `obswebsocket.json` or `obswebsocket.msgpack`, and
//   the server must choose it; obs-websocket-js refuses a connection without
//   it. Under Bun, `import "obs-websocket-js"` resolves to the msgpack build,
//   so sceneManager offers `obswebsocket.msgpack` and every message is a
//   binary msgpack frame. This server answers in whichever was offered.
// - op 0 Hello from the server, with `authentication: { challenge, salt }`
//   when a password is set.
// - op 1 Identify from the client. Its `authentication` is
//   base64(sha256(base64(sha256(password + salt)) + challenge)).
// - op 2 Identified on success. A wrong or missing password closes the socket
//   with 4009 (AuthenticationFailed).
// - op 6 Request `{ requestType, requestId, requestData }`, answered by op 7
//   RequestResponse `{ requestType, requestId, requestStatus, responseData }`.

import { createHash, randomBytes } from "node:crypto";
import { decode, encode } from "@msgpack/msgpack";
import type { Server, ServerWebSocket } from "bun";

const JSON_SUBPROTOCOL = "obswebsocket.json";
const MSGPACK_SUBPROTOCOL = "obswebsocket.msgpack";
const AUTHENTICATION_FAILED = 4009;

export interface FakeObsOptions {
  password?: string;
  /** Serve `wss://` with this certificate. */
  tls?: { cert: string; key: string };
  /** Refuse the upgrade (401) unless this accepts the request URL, as the relay does without a valid ticket. */
  acceptUrl?: (url: URL) => boolean;
  scenes?: { name: string; items: string[] }[];
}

export interface FakeObsServer {
  /** `ws://` or `wss://` URL of the server's root. */
  url: string;
  port: number;
  /** Every request URL that upgraded, in order. */
  upgrades: URL[];
  /** The subprotocol each upgrade chose, in order. */
  protocols: string[];
  /** Request types received, in order. */
  requests: string[];
  stop(): void;
}

interface SocketData {
  challenge: string;
  salt: string;
  msgpack: boolean;
}

function send(ws: ServerWebSocket<SocketData>, message: object): void {
  ws.send(ws.data.msgpack ? encode(message) : JSON.stringify(message));
}

const DEFAULT_SCENES = [
  { name: "Starting", items: ["Countdown"] },
  { name: "Live", items: ["Camera", "Alerts"] },
];

export function obsAuthentication(password: string, salt: string, challenge: string): string {
  const secret = createHash("sha256")
    .update(password + salt)
    .digest("base64");
  return createHash("sha256")
    .update(secret + challenge)
    .digest("base64");
}

export function startFakeObs(options: FakeObsOptions = {}): FakeObsServer {
  const scenes = options.scenes ?? DEFAULT_SCENES;
  const upgrades: URL[] = [];
  const protocols: string[] = [];
  const requests: string[] = [];

  const respond = (
    ws: ServerWebSocket<SocketData>,
    message: { requestType: string; requestId: string; requestData?: Record<string, unknown> }
  ) => {
    requests.push(message.requestType);
    let responseData: Record<string, unknown> | undefined;
    switch (message.requestType) {
      case "GetSceneList":
        responseData = {
          currentProgramSceneName: scenes[0]?.name ?? null,
          scenes: scenes.map((scene, index) => ({
            sceneName: scene.name,
            sceneIndex: index,
            sceneUuid: `scene-${index}`,
          })),
        };
        break;
      case "GetSceneItemList": {
        const scene = scenes.find((s) => s.name === message.requestData?.sceneName);
        responseData = {
          sceneItems: (scene?.items ?? []).map((name, index) => ({
            sceneItemId: index + 1,
            sourceName: name,
            sourceUuid: `${scene?.name}-${name}`,
            inputKind: "browser_source",
          })),
        };
        break;
      }
      default:
        responseData = {};
    }
    send(ws, {
      op: 7,
      d: {
        requestType: message.requestType,
        requestId: message.requestId,
        requestStatus: { result: true, code: 100 },
        responseData,
      },
    });
  };

  const server: Server<SocketData> = Bun.serve<SocketData>({
    port: 0,
    hostname: "127.0.0.1",
    ...(options.tls ? { tls: options.tls } : {}),
    fetch(request, srv) {
      const url = new URL(request.url);
      if (options.acceptUrl && !options.acceptUrl(url)) {
        return new Response("unauthorized", { status: 401 });
      }
      const offered = (request.headers.get("sec-websocket-protocol") ?? "").split(",").map((p) => p.trim());
      const chosen = offered.find((p) => p === JSON_SUBPROTOCOL || p === MSGPACK_SUBPROTOCOL);
      if (!chosen) {
        return new Response("an obswebsocket subprotocol is required", { status: 400 });
      }
      upgrades.push(url);
      protocols.push(chosen);
      const upgraded = srv.upgrade(request, {
        headers: { "Sec-WebSocket-Protocol": chosen },
        data: {
          challenge: randomBytes(16).toString("base64"),
          salt: randomBytes(16).toString("base64"),
          msgpack: chosen === MSGPACK_SUBPROTOCOL,
        },
      });
      return upgraded ? undefined : new Response("upgrade failed", { status: 500 });
    },
    websocket: {
      open(ws) {
        const authentication = options.password ? { challenge: ws.data.challenge, salt: ws.data.salt } : undefined;
        send(ws, { op: 0, d: { obsWebSocketVersion: "5.5.0", rpcVersion: 1, authentication } });
      },
      message(ws, raw) {
        const message = (typeof raw === "string" ? JSON.parse(raw) : decode(raw)) as {
          op: number;
          d: Record<string, unknown>;
        };
        if (message.op === 1) {
          if (options.password) {
            const expected = obsAuthentication(options.password, ws.data.salt, ws.data.challenge);
            if (message.d.authentication !== expected) {
              ws.close(AUTHENTICATION_FAILED, "Authentication failed.");
              return;
            }
          }
          send(ws, { op: 2, d: { negotiatedRpcVersion: 1 } });
          return;
        }
        if (message.op === 6) {
          respond(ws, message.d as { requestType: string; requestId: string; requestData?: Record<string, unknown> });
        }
      },
    },
  });

  const scheme = options.tls ? "wss" : "ws";
  return {
    url: `${scheme}://127.0.0.1:${server.port}`,
    port: server.port ?? 0,
    upgrades,
    protocols,
    requests,
    stop: () => {
      server.stop(true);
    },
  };
}
