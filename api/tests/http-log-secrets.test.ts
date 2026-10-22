import { afterEach, expect, test } from "bun:test";
import type { SharedLogger } from "@woofx3/common/logging";
import { newHttpBatchRpcSession, newWebSocketRpcSession } from "capnweb";
import type { ApiGatewayContract } from "@woofx3/api/rpc";
import { Api } from "../src/api";
import { ClientAuth } from "../src/auth";
import { ClientSessions } from "../src/client-sessions";
import { ApiGateway } from "../src/gateway";
import { createHttpServer } from "../src/http";
import { resolveRegistrationPolicy } from "../src/registration";

const REGISTRATION_TOKEN = "registration-token-that-must-not-be-logged";
const CLIENT_SECRET = "client-secret-that-must-not-be-logged";

type Server = ReturnType<typeof createHttpServer>;
let server: Server | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
});

/** A logger that keeps every line, at every level, as text. */
function recordingLogger() {
  const lines: string[] = [];
  const record =
    (level: string) =>
    (...args: unknown[]) => {
      lines.push(`${level} ${JSON.stringify(args)}`);
    };
  const logger = {
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
  } as unknown as SharedLogger;
  return { logger, lines };
}

function startEngine(logger: SharedLogger) {
  const db = {
    createClient: async () => ({ client: { clientId: "c1", clientSecret: CLIENT_SECRET } }),
    listClients: async () => ({ clients: [] }),
    validateClient: async (_clientId: string, clientSecret: string) =>
      clientSecret === CLIENT_SECRET
        ? { status: { code: "OK" }, client: { description: "desktop" } }
        : { status: { code: "NOT_FOUND" } },
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
  const gateway = new ApiGateway(
    api,
    new ClientAuth(db as never, logger),
    db as never,
    logger,
    resolveRegistrationPolicy({ token: REGISTRATION_TOKEN }),
    new ClientSessions(logger)
  );
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
  return `127.0.0.1:${server.port}/api`;
}

test("registering and authenticating over HTTP batch and WebSocket logs no secret", async () => {
  const { logger, lines } = recordingLogger();
  const address = startEngine(logger);

  const registered = await newHttpBatchRpcSession<ApiGatewayContract>(`http://${address}`).registerClient("ui", {
    registrationToken: REGISTRATION_TOKEN,
  });
  expect(registered.clientSecret).toBe(CLIENT_SECRET);
  await newHttpBatchRpcSession<ApiGatewayContract>(`http://${address}`).authenticate("c1", CLIENT_SECRET);

  const ws = newWebSocketRpcSession<ApiGatewayContract>(`ws://${address}`);
  try {
    await ws.registerClient("ui", { registrationToken: REGISTRATION_TOKEN });
    await ws.authenticate("c1", CLIENT_SECRET);
  } finally {
    ws[Symbol.dispose]();
  }

  expect(lines.some((line) => line.includes("HTTP batch RPC request completed"))).toBe(true);
  expect(lines.some((line) => line.includes("Received WebSocket message"))).toBe(true);
  for (const line of lines) {
    expect(line).not.toContain(REGISTRATION_TOKEN);
    expect(line).not.toContain(CLIENT_SECRET);
  }
});
