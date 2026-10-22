import { describe, expect, it, mock } from "bun:test";
import { AUTHENTICATION_REFUSED, type ApiGatewayContract, isAuthenticationRefused } from "@woofx3/api/rpc";
import { newMessagePortRpcSession } from "capnweb";
import { Api } from "../src/api";
import { ApiSession } from "../src/api-session";
import { ClientAuth } from "../src/auth";
import { ApiGateway, AuthenticationRefused } from "../src/gateway";
import { type ConnectionInfo, GatewayConnection } from "../src/gateway-connection";
import { EngineEventStream } from "../src/engine-event-stream";
import { WebhookClient } from "../src/webhook-client";

const OPEN = { mode: "open", token: null } as const;

const BATCH: ConnectionInfo = { origin: null, remoteAddress: "127.0.0.1", close: null };

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

function newApi(
  db: ConstructorParameters<typeof Api>[0]["db"],
  logger: ConstructorParameters<typeof Api>[0]["logger"]
) {
  return new Api({
    db,
    nats: null,
    functions: null,
    barkloaderUrl: "http://b",
    sceneManagerUrl: "http://scene.test",
    apiUrl: "http://api.test",
    logger,
  });
}

describe("ApiGateway.registerClient", () => {
  it("creates a client with the callback and returns its credentials", async () => {
    const createClient = mock(async () => ({ client: { clientId: "c1", clientSecret: "s1" } }));
    const listClients = mock(async () => ({
      clients: [{ clientId: "c1", description: "test-ui", callbackUrl: "http://cb", callbackToken: "tok" }],
    }));
    const db = { createClient, listClients } as any;
    const logger = fakeLogger();
    const api = newApi(db, logger);
    const webhook = new WebhookClient(db, logger, new EngineEventStream(logger));
    api.setWebhookClient(webhook);
    const auth = { validate: mock(async () => ({ kind: "accepted", description: "test-ui" })) } as any;
    const gateway = new ApiGateway(api, auth, db, logger, OPEN);
    gateway.setWebhookClient(webhook);

    const res = await gateway.registerClient("test-ui", {
      callbackUrl: "http://cb",
      callbackToken: "tok",
    });

    expect(res).toEqual({ clientId: "c1", clientSecret: "s1" });
    expect(createClient).toHaveBeenCalledWith({
      description: "test-ui",
      callbackUrl: "http://cb",
      callbackToken: "tok",
    });
    // The new callback is picked up without a restart.
    expect(listClients).toHaveBeenCalledTimes(1);
  });

  it("does not refresh callbacks for a client registered without one", async () => {
    const listClients = mock(async () => ({ clients: [] }));
    const db = {
      createClient: mock(async () => ({ client: { clientId: "c2", clientSecret: "s2" } })),
      listClients,
    } as any;
    const logger = fakeLogger();
    const api = newApi(db, logger);
    const webhook = new WebhookClient(db, logger, new EngineEventStream(logger));
    api.setWebhookClient(webhook);
    const gateway = new ApiGateway(
      api,
      { validate: mock(async () => ({ kind: "accepted", description: "test-ui" })) } as any,
      db,
      logger,
      OPEN
    );
    gateway.setWebhookClient(webhook);

    const res = await gateway.registerClient("test", {});

    expect(res).toEqual({ clientId: "c2", clientSecret: "s2" });
    expect(listClients).not.toHaveBeenCalled();
  });

  it("fails when db-proxy returns no client", async () => {
    const db = { createClient: mock(async () => ({})) } as any;
    const logger = fakeLogger();
    const gateway = new ApiGateway(
      newApi(db, logger),
      { validate: mock(async () => ({ kind: "accepted", description: "test-ui" })) } as any,
      db,
      logger,
      OPEN
    );

    await expect(gateway.registerClient("test", {})).rejects.toThrow("Failed to create client");
  });
});

/** What `promise` rejected with, or null when it resolved. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (err: unknown) => err
  );
}

describe("ApiGateway.authenticate", () => {
  /** A gateway over the real ClientAuth, whose db-proxy answers `validateClient` with `answer`. */
  function gatewayOver(answer: () => Promise<unknown>) {
    const db = { validateClient: mock(answer) } as any;
    const logger = fakeLogger();
    return new ApiGateway(newApi(db, logger), new ClientAuth(db, logger), db, logger, OPEN);
  }
  const ACCEPTED = async () => ({ status: { code: "OK" }, client: { description: "test-ui" } });
  const NOT_FOUND = async () => ({ status: { code: "NOT_FOUND", message: "Invalid credentials" } });

  it("returns a session for accepted credentials", async () => {
    const session = await gatewayOver(ACCEPTED).authenticate("c1", "s1", BATCH);

    expect(session).toBeInstanceOf(ApiSession);
  });

  it("rejects credentials db-proxy does not know with a named refusal", async () => {
    const err = await rejectionOf(gatewayOver(NOT_FOUND).authenticate("c1", "wrong", BATCH));

    expect(err).toBeInstanceOf(AuthenticationRefused);
    expect((err as Error).name).toBe(AUTHENTICATION_REFUSED);
    expect(isAuthenticationRefused(err)).toBe(true);
  });

  it("does not report a db-proxy failure as a refusal", async () => {
    const err = await rejectionOf(
      gatewayOver(async () => {
        throw new Error("fetch failed");
      }).authenticate("c1", "s1", BATCH)
    );

    expect(err).toBeInstanceOf(Error);
    expect(isAuthenticationRefused(err)).toBe(false);
    expect((err as Error).message).toContain("fetch failed");
  });

  it("keeps the refusal recognisable across a capnweb session", async () => {
    const channel = new MessageChannel();
    const server = newMessagePortRpcSession(channel.port1, new GatewayConnection(gatewayOver(NOT_FOUND), BATCH));
    const client = newMessagePortRpcSession<ApiGatewayContract>(channel.port2);
    try {
      const err = await rejectionOf(client.authenticate("c1", "wrong"));

      // capnweb rebuilds the error as a plain Error, so only the message carries the refusal.
      expect(err).toBeInstanceOf(Error);
      expect(isAuthenticationRefused(err)).toBe(true);
    } finally {
      client[Symbol.dispose]();
      server[Symbol.dispose]();
      channel.port1.close();
      channel.port2.close();
    }
  });
});
