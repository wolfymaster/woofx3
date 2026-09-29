import { describe, expect, it, mock } from "bun:test";
import { ApiGateway } from "../src/gateway";
import { Api } from "../src/api";
import { WebhookClient } from "../src/webhook-client";

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
    const webhook = new WebhookClient(db, logger);
    api.setWebhookClient(webhook);
    const auth = { validate: mock(async () => ({ valid: true })) } as any;
    const gateway = new ApiGateway(api, auth, db, logger, null);
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
    const webhook = new WebhookClient(db, logger);
    api.setWebhookClient(webhook);
    const gateway = new ApiGateway(api, { validate: mock(async () => ({ valid: true })) } as any, db, logger, null);
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
      { validate: mock(async () => ({ valid: true })) } as any,
      db,
      logger,
      null
    );

    await expect(gateway.registerClient("test", {})).rejects.toThrow("Failed to create client");
  });
});
