import { describe, expect, it, mock } from "bun:test";
import { ApiGateway } from "./gateway";
import { Api } from "./api";
import { WebhookClient } from "./webhook-client";

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

describe("ApiGateway.registerClient", () => {
  it("creates user + default application + client and returns applicationId", async () => {
    const findOrCreate = mock(async () => ({ id: "engine-user-1" }));
    const getDefault = mock(async () => null);
    const createApp = mock(async () => ({ id: "app-1", name: "default" }));
    const createClient = mock(async () => ({ client: { clientId: "c1", clientSecret: "s1" } }));
    const listClients = mock(async () => ({ clients: [] }));
    const db = {
      findOrCreateByWoofx3UIUserId: findOrCreate,
      getDefaultApplication: getDefault,
      createApplication: createApp,
      createClient,
      listClients,
    } as any;
    const logger = fakeLogger();
    const api = new Api({ db, nats: null, barkloaderUrl: "http://b", logger });
    const webhook = new WebhookClient(db, logger, null);
    api.setWebhookClient(webhook);
    const auth = { validate: mock(async () => ({ valid: true })) } as any;
    const gateway = new ApiGateway(api, auth, db, logger);
    gateway.setWebhookClient(webhook);

    const res = await gateway.registerClient("test-ui", {
      userId: "convex_user_42",
      callbackUrl: "http://cb",
      callbackToken: "tok",
    });

    expect(res.applicationId).toBe("app-1");
    expect(findOrCreate).toHaveBeenCalledWith("convex_user_42");
    expect(createApp).toHaveBeenCalledWith({ name: "default", ownerId: "engine-user-1", isDefault: true });
    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({ applicationId: "app-1" }));
  });

  it("reuses the existing default application when present", async () => {
    const getDefault = mock(async () => ({ id: "app-existing", name: "default" }));
    const createApp = mock(async () => { throw new Error("should not be called"); });
    const db = {
      findOrCreateByWoofx3UIUserId: mock(async () => ({ id: "u1" })),
      getDefaultApplication: getDefault,
      createApplication: createApp,
      createClient: mock(async () => ({ client: { clientId: "c2", clientSecret: "s2" } })),
      listClients: mock(async () => ({ clients: [] })),
    } as any;
    const logger = fakeLogger();
    const api = new Api({ db, nats: null, barkloaderUrl: "http://b", logger });
    const webhook = new WebhookClient(db, logger, null);
    api.setWebhookClient(webhook);
    const gateway = new ApiGateway(api, { validate: mock(async () => ({ valid: true })) } as any, db, logger);
    gateway.setWebhookClient(webhook);

    const res = await gateway.registerClient("test", { userId: "convex_user_42" });

    expect(res.applicationId).toBe("app-existing");
    expect(createApp).not.toHaveBeenCalled();
  });

  it("rejects empty userId", async () => {
    const db = { findOrCreateByWoofx3UIUserId: mock(async () => ({ id: "u1" })) } as any;
    const logger = fakeLogger();
    const api = new Api({ db, nats: null, barkloaderUrl: "http://b", logger });
    const gateway = new ApiGateway(api, { validate: mock(async () => ({ valid: true })) } as any, db, logger);

    await expect(gateway.registerClient("test", { userId: "" })).rejects.toThrow();
  });
});
