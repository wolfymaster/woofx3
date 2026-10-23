import { afterEach, describe, expect, test } from "bun:test";
import type { Woofx3EngineApi } from "@woofx3/api";
import { type ApiGatewayContract, isAuthenticationRefused } from "@woofx3/api/rpc";
import type { SharedLogger } from "@woofx3/common/logging";
import { Api } from "../src/api";
import { ClientAuth } from "../src/auth";
import { ClientSessions } from "../src/client-sessions";
import { ApiGateway } from "../src/gateway";
import { newWebSocketRpcSession } from "capnweb";
import type { ConnectionInfo } from "../src/gateway-connection";
import { createHttpServer } from "../src/http";
import { resolveRegistrationPolicy } from "../src/registration";

const logger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as SharedLogger;

const PAIRED_FROM = "http://localhost:5173";

/** A gateway whose db-proxy knows `paired`, bound to PAIRED_FROM, and `registered`. */
function gateway() {
  const db = {
    async validateClient(clientId: string) {
      if (clientId === "paired") {
        return {
          status: { code: "OK" },
          client: { description: "Chrome", kind: "CLIENT_KIND_PAIRED", origin: PAIRED_FROM },
        };
      }
      if (clientId === "paired-elsewhere") {
        return {
          status: { code: "OK" },
          client: { description: "Firefox", kind: "CLIENT_KIND_PAIRED", origin: "http://localhost:3000" },
        };
      }
      return { status: { code: "OK" }, client: { description: "desktop", kind: "CLIENT_KIND_REGISTERED", origin: "" } };
    },
  };
  const api = new Api({
    db: db as never,
    nats: null,
    functions: null,
    barkloaderUrl: "http://b",
    sceneManagerUrl: "http://scene.test",
    apiUrl: "http://api.test",
    logger,
  });
  return new ApiGateway(
    api,
    new ClientAuth(db as never, logger),
    db as never,
    logger,
    resolveRegistrationPolicy({}),
    new ClientSessions(logger)
  );
}

function from(origin: string | null): ConnectionInfo {
  return { origin, remoteAddress: "127.0.0.1", close: null, onEnd() {} };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (err: unknown) => err
  );
}

describe("authenticating a paired client", () => {
  test.each([
    [PAIRED_FROM],
    ["HTTP://LOCALHOST:5173"],
  ])("is accepted from the origin it paired from (%s)", async (origin) => {
    expect(await rejectionOf(gateway().authenticate("paired", "s", from(origin)))).toBeNull();
  });

  test.each([
    ["another port", "http://localhost:3000"],
    ["another scheme", "https://localhost:5173"],
    ["another host", "http://127.0.0.1:5173"],
    ["the opaque origin", "null"],
    ["no Origin header", null],
  ])("is refused from %s, as wrong credentials are", async (_, origin) => {
    const err = await rejectionOf(gateway().authenticate("paired", "s", from(origin)));

    expect(isAuthenticationRefused(err)).toBe(true);
    expect((err as Error).message).toBe("AuthenticationRefused: Invalid client credentials");
  });
});

describe("authenticating a registered client", () => {
  test.each([
    [PAIRED_FROM],
    ["https://elsewhere.example"],
    [null],
  ])("is accepted from any origin (%s)", async (origin) => {
    expect(await rejectionOf(gateway().authenticate("registered", "s", from(origin)))).toBeNull();
  });
});

describe("over a WebSocket", () => {
  let server: ReturnType<typeof createHttpServer> | null = null;
  afterEach(() => {
    server?.stop(true);
    server = null;
  });

  test("a session sees the Origin of the socket's upgrade request", async () => {
    server = createHttpServer({
      port: 0,
      hostname: "127.0.0.1",
      readiness: async () => ({}) as never,
      health: () => ({}) as never,
      logger,
      gateway: gateway(),
      requestGuard: { allowedHosts: null, allowedOrigins: null },
      onProcessingCallback: async () => {},
      barkloaderWebhookSecret: null,
    });
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/api`, { headers: { Origin: PAIRED_FROM } } as never);
    const stub = newWebSocketRpcSession<ApiGatewayContract>(socket);
    try {
      const own = stub.authenticate("paired", "s") as unknown as Woofx3EngineApi;
      const other = stub.authenticate("paired-elsewhere", "s") as unknown as Woofx3EngineApi;

      expect(await own.ping()).toEqual({ status: "ok" });
      expect(isAuthenticationRefused(await rejectionOf(other.ping()))).toBe(true);
    } finally {
      stub[Symbol.dispose]();
    }
  });
});
