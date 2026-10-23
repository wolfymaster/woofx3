import { afterEach, describe, expect, test } from "bun:test";
import type { Woofx3EngineApi } from "@woofx3/api";
import { type ApiGatewayContract, CLIENT_REVOKED_CLOSE_CODE, isAuthenticationRefused } from "@woofx3/api/rpc";
import type { SharedLogger } from "@woofx3/common/logging";
import { EngineEventType } from "@woofx3/api/webhooks";
import { newMessagePortRpcSession, newWebSocketRpcSession, RpcTarget } from "capnweb";
import { Api } from "../src/api";
import { ClientAuth } from "../src/auth";
import { ClientRevoker, ClientSessions, SessionLease } from "../src/client-sessions";
import { EngineEventStream } from "../src/engine-event-stream";
import { ApiSession } from "../src/api-session";
import { ApiGateway } from "../src/gateway";
import { GatewayConnection } from "../src/gateway-connection";
import { createHttpServer } from "../src/http";
import { WebhookClient } from "../src/webhook-client";
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
  /** Each client's callback URL, for the clients that registered one. */
  const callbackUrls: Record<string, string> = {};
  let listFails = false;
  const db = {
    async validateClient(clientId: string, clientSecret: string) {
      const known = CREDENTIALS[clientId] === clientSecret && !deleted.has(clientId);
      if (held) {
        await held;
      }
      return known
        ? { status: { code: "OK" }, client: { description: clientId, kind: "CLIENT_KIND_REGISTERED", origin: "" } }
        : { status: { code: "NOT_FOUND", message: "Invalid credentials" } };
    },
    async listClients() {
      if (listFails) {
        throw new Error("db-proxy unavailable");
      }
      return {
        clients: Object.keys(callbackUrls)
          .filter((clientId) => !deleted.has(clientId))
          .map((clientId) => ({
            clientId,
            description: clientId,
            callbackUrl: callbackUrls[clientId],
            callbackToken: "t",
          })),
      };
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
  const stream = new EngineEventStream(logger);
  const webhooks = new WebhookClient(db as never, logger, stream);
  api.setWebhookClient(webhooks);
  api.setClientRevocation(new ClientRevoker(auth, sessions, stream, webhooks, api));
  const gateway = new ApiGateway(api, auth, db as never, logger, resolveRegistrationPolicy({}), sessions);
  return {
    api,
    gateway,
    sessions,
    webhooks,
    /** Give `clientId` a callback URL, as if it registered with one, and load it. */
    async withCallback(clientId: string, url: string) {
      callbackUrls[clientId] = url;
      await webhooks.refreshCallbackUrls();
    },
    failListing() {
      listFails = true;
    },
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

  test("stops callbacks to the client at once, even when the refresh after the delete fails", async () => {
    const { gateway, webhooks, withCallback, failListing } = engine();
    const received: string[] = [];
    const callbacks = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        received.push(((await req.json()) as { type: string }).type);
        return Response.json({});
      },
    });
    try {
      await withCallback("doomed", `http://127.0.0.1:${callbacks.port}/callback`);
      using adminPort = overMessagePort(gateway);
      const admin = adminPort.client.authenticate("admin", CREDENTIALS.admin) as unknown as Woofx3EngineApi;

      failListing();
      expect(await admin.deleteClient("doomed")).toEqual({ success: true, message: "Client deleted" });
      await webhooks.send({ type: EngineEventType.WORKFLOW_DELETED, workflowId: "w1" });

      expect(received).toEqual([]);
      expect(webhooks.clientIds()).not.toContain("doomed");
    } finally {
      callbacks.stop(true);
    }
  });

  test("gives callbacks back to a client whose delete failed, once the list is refreshed", async () => {
    const { gateway, webhooks, withCallback, failNextDelete } = engine();
    const received: string[] = [];
    const callbacks = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        received.push(((await req.json()) as { type: string }).type);
        return Response.json({});
      },
    });
    try {
      await withCallback("doomed", `http://127.0.0.1:${callbacks.port}/callback`);
      using adminPort = overMessagePort(gateway);
      const admin = adminPort.client.authenticate("admin", CREDENTIALS.admin) as unknown as Woofx3EngineApi;

      failNextDelete("notOk");
      expect((await admin.deleteClient("doomed")).success).toBe(false);
      await webhooks.refreshCallbackUrls();
      await webhooks.send({ type: EngineEventType.WORKFLOW_DELETED, workflowId: "w1" });

      expect(received).toEqual([EngineEventType.WORKFLOW_DELETED]);
    } finally {
      callbacks.stop(true);
    }
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

describe("a revoked client's subscriptions", () => {
  /** Trigger-change pushes reaching a client's callback. */
  class TriggerListener extends RpcTarget {
    received: string[] = [];
    async onTriggerChange(event: { type: string; moduleName: string }) {
      this.received.push(event.moduleName);
    }
  }

  function notifyTriggerChange(api: Api, moduleName: string): Promise<void> {
    return (api as unknown as { notifyTriggerChange(name: string): Promise<void> }).notifyTriggerChange(moduleName);
  }

  test("end on revocation even after the client disposed the session that made them", async () => {
    const { api, gateway } = engine();
    const url = serve(gateway);
    const doomedGateway = newWebSocketRpcSession<ApiGatewayContract>(url);
    const doomed = doomedGateway.authenticate("doomed", CREDENTIALS.doomed) as unknown as Woofx3EngineApi & Disposable;
    const listener = new TriggerListener();
    await doomed.subscribeTriggerChanges(listener);
    await notifyTriggerChange(api, "before");
    expect(listener.received).toEqual(["before"]);

    // The session stub goes; the socket, and the listener the engine holds, stay.
    doomed[Symbol.dispose]();
    using adminPort = overMessagePort(gateway);
    const admin = adminPort.client.authenticate("admin", CREDENTIALS.admin) as unknown as Woofx3EngineApi;
    await admin.deleteClient("doomed");
    await notifyTriggerChange(api, "after");

    expect(listener.received).toEqual(["before"]);
    doomedGateway[Symbol.dispose]();
  });

  test("end on revocation for a session the registry no longer tracks", async () => {
    const api = new Api({
      db: {} as never,
      nats: null,
      functions: null,
      barkloaderUrl: "http://b",
      sceneManagerUrl: "http://scene.test",
      apiUrl: "http://api.test",
      logger,
    });
    const sessions = new ClientSessions(logger);
    const revoker = new ClientRevoker(
      { invalidateCache() {} },
      sessions,
      { dropClient() {} },
      { dropClient() {} },
      api
    );
    const lease = new SessionLease(() => {});
    const doomed = new ApiSession(api, "doomed", lease);
    const kept = new ApiSession(api, "admin", new SessionLease(() => {}));
    await doomed.subscribeTriggerChanges({ async onTriggerChange() {} });
    await kept.subscribeTriggerChanges({ async onTriggerChange() {} });

    revoker.revoke("doomed");

    const subscribers = (api as unknown as { triggerSubscribers: Map<object, { session: object }> }).triggerSubscribers;
    expect([...subscribers.values()].map((owner) => owner.session)).toEqual([kept]);
  });

  test("end when the client disposes the session that made them", async () => {
    const api = new Api({
      db: {} as never,
      nats: null,
      functions: null,
      barkloaderUrl: "http://b",
      sceneManagerUrl: "http://scene.test",
      apiUrl: "http://api.test",
      logger,
    });
    const session = new ApiSession(api, "c1", new SessionLease(() => {}));
    await session.subscribeTriggerChanges({ async onTriggerChange() {} });

    session[Symbol.dispose]();

    expect((api as unknown as { triggerSubscribers: Map<object, object> }).triggerSubscribers.size).toBe(0);
  });
});
