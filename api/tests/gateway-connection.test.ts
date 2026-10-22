import { afterEach, describe, expect, test } from "bun:test";
import type { ApiGatewayContract } from "@woofx3/api/rpc";
import type { SharedLogger } from "@woofx3/common/logging";
import { newHttpBatchRpcSession, newWebSocketRpcSession } from "capnweb";
import type { ApiGateway } from "../src/gateway";
import { type ConnectionInfo, GatewayConnection } from "../src/gateway-connection";
import { createHttpServer } from "../src/http";

const logger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as SharedLogger;
const ORIGIN = "http://localhost:5173";

type Server = ReturnType<typeof createHttpServer>;
let server: Server | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
});

/** A server whose gateway records the connection each `authenticate` arrived on, and refuses it. */
function startRecordingEngine() {
  const connections: ConnectionInfo[] = [];
  const gateway = {
    async ping() {
      return { status: "ok" };
    },
    async authenticate(_clientId: string, _clientSecret: string, connection: ConnectionInfo) {
      connections.push(connection);
      throw new Error("recorded");
    },
  } as unknown as ApiGateway;
  server = createHttpServer({
    port: 0,
    hostname: "127.0.0.1",
    readiness: async () => ({}) as never,
    health: () => ({}) as never,
    logger,
    gateway,
    requestGuard: { allowedHosts: null, allowedOrigins: null },
    onProcessingCallback: async () => {},
    barkloaderWebhookSecret: null,
  });
  return { connections, address: `127.0.0.1:${server.port}/api` };
}

async function settled(promise: Promise<unknown>): Promise<void> {
  await promise.then(
    () => {},
    () => {}
  );
}

describe("GatewayConnection", () => {
  test("serves exactly the gateway contract", () => {
    const served = Object.getOwnPropertyNames(GatewayConnection.prototype)
      .filter((key) => key !== "constructor")
      .sort();

    expect(served).toEqual(["authenticate", "ping", "registerClient"] satisfies (keyof ApiGatewayContract)[]);
  });

  test("a WebSocket's calls carry its origin, peer and a way to close it", async () => {
    const { connections, address } = startRecordingEngine();
    const socket = new WebSocket(`ws://${address}`, { headers: { Origin: ORIGIN } } as never);
    const closed = new Promise<number>((resolve) => {
      socket.addEventListener("close", (event) => resolve(event.code));
    });
    const client = newWebSocketRpcSession<ApiGatewayContract>(socket);

    await settled(client.authenticate("c1", "s1"));

    expect(connections).toHaveLength(1);
    const [connection] = connections;
    expect(connection.origin).toBe(ORIGIN);
    expect(connection.remoteAddress).toBe("127.0.0.1");
    expect(connection.close).not.toBeNull();

    connection.close?.(4401, "client revoked");
    expect(await closed).toBe(4401);
    client[Symbol.dispose]();
  });

  test("an HTTP batch's calls carry its origin and peer, with nothing to close", async () => {
    const { connections, address } = startRecordingEngine();
    const request = new Request(`http://${address}`, { headers: { Origin: ORIGIN } });

    await settled(newHttpBatchRpcSession<ApiGatewayContract>(request).authenticate("c1", "s1"));

    expect(connections).toEqual([{ origin: ORIGIN, remoteAddress: "127.0.0.1", close: null }]);
  });

  test("a call with no Origin header has a null origin", async () => {
    const { connections, address } = startRecordingEngine();

    await settled(newHttpBatchRpcSession<ApiGatewayContract>(`http://${address}`).authenticate("c1", "s1"));

    expect(connections[0]?.origin).toBeNull();
  });
});
