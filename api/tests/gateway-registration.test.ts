import { describe, expect, it, mock } from "bun:test";
import { REGISTRATION_REFUSED } from "@woofx3/api/rpc";
import { Api } from "../src/api";
import { ApiGateway } from "../src/gateway";

const TOKEN = "managed-engine-registration-token";

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as never as ConstructorParameters<typeof ApiGateway>[3] & { warn: ReturnType<typeof mock> };
}

/** A gateway over a db that registers successfully, guarded by `registrationToken`. */
function gateway(registrationToken: string | null) {
  const createClient = mock(async () => ({ client: { clientId: "c1", clientSecret: "s1" } }));
  const db = {
    findOrCreateByWoofx3UIUserId: mock(async () => ({ id: "engine-user-1" })),
    getDefaultApplication: mock(async () => ({ id: "app-1", name: "default" })),
    createApplication: mock(async () => ({ id: "app-1", name: "default" })),
    createClient,
    listClients: mock(async () => ({ clients: [] })),
  } as never;
  const logger = fakeLogger();
  const api = new Api({
    db,
    nats: null,
    functions: null,
    barkloaderUrl: "http://b",
    sceneManagerUrl: "http://scene.test",
    apiUrl: "http://api.test",
    logger,
  });
  return {
    gateway: new ApiGateway(api, {} as never, db, logger, registrationToken),
    createClient,
    logger,
  };
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected registerClient to be refused");
}

describe("registerClient on an engine with a registration token", () => {
  it("refuses a caller that sends no token", async () => {
    const { gateway: gw, createClient } = gateway(TOKEN);

    const err = await refusal(gw.registerClient("ui", { userId: "u1" }));

    expect(err.name).toBe(REGISTRATION_REFUSED);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("refuses a caller that sends the wrong token", async () => {
    const { gateway: gw, createClient } = gateway(TOKEN);

    for (const wrong of ["", "nope", `${TOKEN}x`, TOKEN.slice(1)]) {
      const err = await refusal(gw.registerClient("ui", { userId: "u1", registrationToken: wrong }));
      expect(err.name).toBe(REGISTRATION_REFUSED);
    }
    expect(createClient).not.toHaveBeenCalled();
  });

  it("registers a caller that sends the right token", async () => {
    const { gateway: gw, createClient } = gateway(TOKEN);

    const result = await gw.registerClient("ui", { userId: "u1", registrationToken: TOKEN });

    expect(result).toEqual({ clientId: "c1", clientSecret: "s1", applicationId: "app-1" });
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("does not warn at startup", () => {
    const { logger } = gateway(TOKEN);

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe("registerClient on an engine without a registration token", () => {
  it("registers any caller, as bring-your-own engines always have", async () => {
    const { gateway: gw } = gateway(null);

    const result = await gw.registerClient("ui", { userId: "u1" });

    expect(result.clientId).toBe("c1");
  });

  it("warns once at startup that registration is open", () => {
    const { logger } = gateway(null);

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe("registerClient and application-scoped components", () => {
  it("starts them for the application the registration resolved", async () => {
    const { gateway: gw } = gateway(null);
    const start = mock(async (_applicationId: string) => {});
    gw.setApplicationScope({ start } as never);

    await gw.registerClient("ui", { userId: "u1" });

    expect(start).toHaveBeenCalledWith("app-1");
  });

  it("still registers when they fail to start, and says so", async () => {
    const { gateway: gw, logger } = gateway(null);
    gw.setApplicationScope({
      start: async () => {
        throw new Error("NATS not ready");
      },
    } as never);

    const result = await gw.registerClient("ui", { userId: "u1" });

    expect(result.clientId).toBe("c1");
    expect((logger as never as { error: ReturnType<typeof mock> }).error).toHaveBeenCalledTimes(1);
  });
});
