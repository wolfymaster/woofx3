import { afterEach, describe, expect, test } from "bun:test";
import type { Woofx3EngineApi } from "@woofx3/api";
import { type ApiGatewayContract, CLIENT_REVOKED_CLOSE_CODE, isAuthenticationRefused } from "@woofx3/api/rpc";
import type { SharedLogger } from "@woofx3/common/logging";
import { newMessagePortRpcSession, newWebSocketRpcSession } from "capnweb";
import { Api } from "../src/api";
import { ClientAuth } from "../src/auth";
import { ClientRevoker, ClientSessions } from "../src/client-sessions";
import { EngineEventStream } from "../src/engine-event-stream";
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
  /** What the next deleteClient does instead of deleting; null deletes normally. */
  let deleteFailure: "throwAfterCommit" | "notOk" | null = null;
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
      if (deleteFailure === "notOk") {
        return { code: "INTERNAL", message: "database is locked" };
      }
      deleted.add(id);
      if (deleteFailure === "throwAfterCommit") {
        throw new Error("connection reset after the delete committed");
      }
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
  api.setClientRevocation(new ClientRevoker(auth, sessions, new EngineEventStream(logger)));
  const gateway = new ApiGateway(api, auth, db as never, logger, resolveRegistrationPolicy({}), sessions);
  return {
    gateway,
    sessions,
    failNextDelete(failure: "throwAfterCommit" | "notOk") {
      deleteFailure = failure;
    },
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
  test("answers a client that deletes itself before closing its socket", async () => {
    const { gateway } = engine();
    const url = serve(gateway);
    const socket = new WebSocket(url);
    const closed = new Promise<number>((resolve) => {
      socket.addEventListener("close", (event) => resolve(event.code));
    });
    const doomedGateway = newWebSocketRpcSession<ApiGatewayContract>(socket);
    const doomed = doomedGateway.authenticate("doomed", CREDENTIALS.doomed) as unknown as Woofx3EngineApi;

    expect(await doomed.deleteClient("doomed")).toEqual({ success: true, message: "Client deleted" });
    expect(await closed).toBe(CLIENT_REVOKED_CLOSE_CODE);
    doomedGateway[Symbol.dispose]();
  });

  test("keeps a socket open that still carries another client's session", async () => {
    const { gateway } = engine();
    const url = serve(gateway);
    const socket = new WebSocket(url);
    let closeCode: number | null = null;
    socket.addEventListener("close", (event) => {
      closeCode = event.code;
    });
    const shared = newWebSocketRpcSession<ApiGatewayContract>(socket);
    const doomed = shared.authenticate("doomed", CREDENTIALS.doomed) as unknown as Woofx3EngineApi;
    const admin = shared.authenticate("admin", CREDENTIALS.admin) as unknown as Woofx3EngineApi;
    await doomed.ping();

    expect(await admin.deleteClient("doomed")).toEqual({ success: true, message: "Client deleted" });
    await Bun.sleep(20);

    expect(closeCode).toBeNull();
    expect(isAuthenticationRefused(await rejectionOf(doomed.ping()))).toBe(true);
    expect(await admin.ping()).toEqual({ status: "ok" });
    shared[Symbol.dispose]();
  });

  test("still ends the sessions when the delete commits and then fails on its way back", async () => {
    const { gateway, failNextDelete } = engine();
    using doomedPort = overMessagePort(gateway);
    using adminPort = overMessagePort(gateway);
    const doomed = doomedPort.client.authenticate("doomed", CREDENTIALS.doomed) as unknown as Woofx3EngineApi;
    const admin = adminPort.client.authenticate("admin", CREDENTIALS.admin) as unknown as Woofx3EngineApi;
    await doomed.ping();

    failNextDelete("throwAfterCommit");
    expect(await rejectionOf(admin.deleteClient("doomed"))).toBeInstanceOf(Error);

    expect(isAuthenticationRefused(await rejectionOf(doomed.ping()))).toBe(true);
  });

  test("reports a delete db-proxy did not perform as a failure", async () => {
    const { gateway, failNextDelete } = engine();
    using adminPort = overMessagePort(gateway);
    const admin = adminPort.client.authenticate("admin", CREDENTIALS.admin) as unknown as Woofx3EngineApi;

    failNextDelete("notOk");
    const result = await admin.deleteClient("doomed");

    expect(result.success).toBe(false);
    expect(result.message).toContain("database is locked");
  });
});

describe("a session disposed by its client", () => {
  test("is forgotten without waiting for the socket to close", async () => {
    const { gateway, sessions } = engine();
    const gatewayStub = newWebSocketRpcSession<ApiGatewayContract>(serve(gateway));

    for (let round = 0; round < 50; round++) {
      const session = gatewayStub.authenticate("admin", CREDENTIALS.admin) as unknown as Woofx3EngineApi & Disposable;
      await session.ping();
      session[Symbol.dispose]();
    }
    const deadline = Date.now() + 2_000;
    while (sessions.size > 0 && Date.now() < deadline) {
      await Bun.sleep(5);
    }

    expect(sessions.size).toBe(0);
    gatewayStub[Symbol.dispose]();
  });
});
