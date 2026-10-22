import { afterEach, describe, expect, test } from "bun:test";
import type { Woofx3EngineApi } from "@woofx3/api";
import { type ApiGatewayContract, CLIENT_REVOKED_CLOSE_CODE, isAuthenticationRefused } from "@woofx3/api/rpc";
import type { SharedLogger } from "@woofx3/common/logging";
import { newMessagePortRpcSession, newWebSocketRpcSession } from "capnweb";
import { Api } from "../src/api";
import { ClientAuth } from "../src/auth";
import { ClientSessions } from "../src/client-sessions";
import { ApiGateway } from "../src/gateway";
import { GatewayConnection } from "../src/gateway-connection";
import { createHttpServer } from "../src/http";
import { resolveRegistrationPolicy } from "../src/registration";

/*
 * Deleting a client ends the sessions it already holds: an open WebSocket is
 * closed, any call still arriving is refused, and a session that was
 * authenticating while the client was deleted is refused too.
 */

const logger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as SharedLogger;

const CREDENTIALS: Record<string, string> = { doomed: "doomed-secret", admin: "admin-secret" };

type Server = ReturnType<typeof createHttpServer>;
let server: Server | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
});

/** What `promise` rejected with, or null when it resolved. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (err: unknown) => err
  );
}

/**
 * An engine over a db-proxy that knows `doomed` and `admin`, wired as
 * application.ts wires it. `holdValidation` makes the next `validateClient`
 * wait until the returned release is called, with the answer db-proxy would
 * have given when the call started.
 */
function engine() {
  const deleted = new Set<string>();
  let held: Promise<void> | null = null;
  const db = {
    async validateClient(clientId: string, clientSecret: string) {
      const known = CREDENTIALS[clientId] === clientSecret && !deleted.has(clientId);
      if (held) {
        await held;
      }
      return known
        ? { status: { code: "OK" }, client: { description: clientId } }
        : { status: { code: "NOT_FOUND", message: "Invalid credentials" } };
    },
    async getClientByClientID(clientId: string) {
      return deleted.has(clientId) || !(clientId in CREDENTIALS) ? {} : { client: { id: clientId, clientId } };
    },
    async deleteClient(id: string) {
      deleted.add(id);
      return { code: "OK" };
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
  const auth = new ClientAuth(db as never, logger);
  const sessions = new ClientSessions(logger);
  api.setClientRevocation({
    revoke(clientId) {
      auth.invalidateCache();
      sessions.revoke(clientId);
    },
  });
  const gateway = new ApiGateway(api, auth, db as never, logger, resolveRegistrationPolicy({}), sessions);
  return {
    gateway,
    holdValidation(): () => void {
      let release = () => {};
      held = new Promise<void>((resolve) => {
        release = () => {
          held = null;
          resolve();
        };
      });
      return release;
    },
  };
}

function serve(gateway: ApiGateway): string {
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
  return `ws://127.0.0.1:${server.port}/api`;
}

/** A gateway session over a MessageChannel: a transport with no socket for the engine to close. */
function overMessagePort(gateway: ApiGateway) {
  const channel = new MessageChannel();
  const served = newMessagePortRpcSession(
    channel.port1,
    new GatewayConnection(gateway, { origin: null, remoteAddress: null, close: null, onEnd() {} })
  );
  const client = newMessagePortRpcSession<ApiGatewayContract>(channel.port2);
  return {
    client,
    [Symbol.dispose]() {
      client[Symbol.dispose]();
      served[Symbol.dispose]();
      channel.port1.close();
      channel.port2.close();
    },
  };
}

describe("deleting a client", () => {
  test("closes its open WebSocket and refuses its credentials afterwards", async () => {
    const { gateway } = engine();
    const url = serve(gateway);
    const socket = new WebSocket(url);
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      socket.addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason }));
    });
    const doomedGateway = newWebSocketRpcSession<ApiGatewayContract>(socket);
    const doomed = doomedGateway.authenticate("doomed", CREDENTIALS.doomed) as unknown as Woofx3EngineApi;
    expect(await doomed.ping()).toEqual({ status: "ok" });

    const adminGateway = newWebSocketRpcSession<ApiGatewayContract>(url);
    const admin = adminGateway.authenticate("admin", CREDENTIALS.admin) as unknown as Woofx3EngineApi;
    expect(await admin.deleteClient("doomed")).toEqual({ success: true, message: "Client deleted" });

    expect(await closed).toEqual({ code: CLIENT_REVOKED_CLOSE_CODE, reason: "client revoked" });
    expect(await rejectionOf(doomed.ping())).toBeInstanceOf(Error);

    // The cached acceptance went with the client: reconnecting is refused.
    const retry = newWebSocketRpcSession<ApiGatewayContract>(url);
    const refused = await rejectionOf(
      (retry.authenticate("doomed", CREDENTIALS.doomed) as unknown as Woofx3EngineApi).ping()
    );
    expect(isAuthenticationRefused(refused)).toBe(true);

    // The admin's own session is untouched.
    expect(await admin.ping()).toEqual({ status: "ok" });
    for (const session of [doomedGateway, adminGateway, retry]) {
      session[Symbol.dispose]();
    }
  });

  test("refuses every later call on a session that has no socket to close", async () => {
    const { gateway } = engine();
    using doomedPort = overMessagePort(gateway);
    using adminPort = overMessagePort(gateway);
    const doomed = doomedPort.client.authenticate("doomed", CREDENTIALS.doomed) as unknown as Woofx3EngineApi;
    const admin = adminPort.client.authenticate("admin", CREDENTIALS.admin) as unknown as Woofx3EngineApi;
    expect(await doomed.ping()).toEqual({ status: "ok" });

    await admin.deleteClient("doomed");

    // A hand-written method and a delegated one: the check covers both.
    expect(isAuthenticationRefused(await rejectionOf(doomed.ping()))).toBe(true);
    expect(isAuthenticationRefused(await rejectionOf(doomed.setRelayConfig(null)))).toBe(true);
    expect(await admin.ping()).toEqual({ status: "ok" });
  });

  test("refuses a session that was authenticating while the client was deleted", async () => {
    const { gateway, holdValidation } = engine();
    using adminPort = overMessagePort(gateway);
    const admin = adminPort.client.authenticate("admin", CREDENTIALS.admin) as unknown as Woofx3EngineApi;
    await admin.ping();

    // db-proxy accepts the credentials, but its answer arrives only after
    // the client is deleted.
    const release = holdValidation();
    const authenticating = rejectionOf(
      gateway.authenticate("doomed", CREDENTIALS.doomed, {
        origin: null,
        remoteAddress: null,
        close: null,
        onEnd() {},
      })
    );
    await admin.deleteClient("doomed");
    release();

    expect(isAuthenticationRefused(await authenticating)).toBe(true);
  });
});
