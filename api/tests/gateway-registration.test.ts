import { describe, expect, it, mock } from "bun:test";
import { REGISTRATION_REFUSED } from "@woofx3/api/rpc";
import { Api } from "../src/api";
import { ApiGateway } from "../src/gateway";
import { type RegistrationMode, resolveRegistrationPolicy } from "../src/registration";

const TOKEN = "managed-engine-registration-token";

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as never as ConstructorParameters<typeof ApiGateway>[3] & { warn: ReturnType<typeof mock> };
}

/**
 * A gateway over a db that registers successfully. With no mode, the policy is
 * the one an unset WOOFX3_REGISTRATION_MODE derives from `registrationToken`.
 */
function gateway(registrationToken: string | null, mode?: RegistrationMode) {
  const clients: { clientId: string }[] = [];
  const createClient = mock(async () => {
    // Yields first, so concurrent registrations interleave as they would against the db proxy.
    await Promise.resolve();
    const client = { clientId: `c${clients.length + 1}`, clientSecret: "s1" };
    clients.push(client);
    return { client };
  });
  const db = {
    createClient,
    listClients: mock(async () => ({ clients: [...clients] })),
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
    gateway: new ApiGateway(
      api,
      {} as never,
      db,
      logger,
      resolveRegistrationPolicy({ token: registrationToken ?? undefined, mode })
    ),
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

    const err = await refusal(gw.registerClient("ui", {}));

    expect(err.name).toBe(REGISTRATION_REFUSED);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("refuses a caller that sends the wrong token", async () => {
    const { gateway: gw, createClient } = gateway(TOKEN);

    for (const wrong of ["", "nope", `${TOKEN}x`, TOKEN.slice(1)]) {
      const err = await refusal(gw.registerClient("ui", { registrationToken: wrong }));
      expect(err.name).toBe(REGISTRATION_REFUSED);
    }
    expect(createClient).not.toHaveBeenCalled();
  });

  it("registers a caller that sends the right token", async () => {
    const { gateway: gw, createClient } = gateway(TOKEN);

    const result = await gw.registerClient("ui", { registrationToken: TOKEN });

    expect(result).toEqual({ clientId: "c1", clientSecret: "s1" });
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("does not warn at startup", () => {
    const { logger } = gateway(TOKEN);

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe("registerClient on an engine without a registration token or mode", () => {
  it("registers the first caller", async () => {
    const { gateway: gw } = gateway(null);

    const result = await gw.registerClient("ui", {});

    expect(result.clientId).toBe("c1");
  });

  it("refuses a second registration, since there is no token to present", async () => {
    const { gateway: gw, createClient } = gateway(null);
    await gw.registerClient("ui", {});

    const err = await refusal(gw.registerClient("intruder", {}));

    expect(err.name).toBe(REGISTRATION_REFUSED);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("does not warn that registration is open", () => {
    const { logger } = gateway(null);

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe("registerClient callback URLs", () => {
  const refused = [
    "file:///etc/passwd",
    "http://internal.example/hook",
    "https://user:pass@example.com/hook",
    "https://example.com/hook#fragment",
    "gopher://example.com/hook",
  ];
  for (const callbackUrl of refused) {
    it(`refuses ${callbackUrl} before creating a client`, async () => {
      const { gateway: gw, createClient } = gateway(null);

      const err = await refusal(gw.registerClient("ui", { callbackUrl }));

      expect(err.name).toBe(REGISTRATION_REFUSED);
      expect(createClient).not.toHaveBeenCalled();
    });
  }

  for (const callbackUrl of ["https://example.convex.site/api/webhooks/woofx3", "http://127.0.0.1:3000/hook"]) {
    it(`accepts ${callbackUrl}`, async () => {
      const { gateway: gw } = gateway(null, "open");

      expect((await gw.registerClient("ui", { callbackUrl })).clientId).toBe("c1");
    });
  }
});

describe("registerClient in first mode", () => {
  it("admits the first caller without a token", async () => {
    const { gateway: gw } = gateway(null, "first");

    const result = await gw.registerClient("desktop", {});

    expect(result.clientId).toBe("c1");
  });

  it("then requires the token, when there is one", async () => {
    const { gateway: gw, createClient } = gateway(TOKEN, "first");
    await gw.registerClient("desktop", {});

    const err = await refusal(gw.registerClient("intruder", {}));
    expect(err.name).toBe(REGISTRATION_REFUSED);
    const wrong = await refusal(gw.registerClient("intruder", { registrationToken: "nope" }));
    expect(wrong.name).toBe(REGISTRATION_REFUSED);

    const second = await gw.registerClient("dashboard", { registrationToken: TOKEN });
    expect(second.clientId).toBe("c2");
    expect(createClient).toHaveBeenCalledTimes(2);
  });

  it("then refuses everyone, when there is no token", async () => {
    const { gateway: gw } = gateway(null, "first");
    await gw.registerClient("desktop", {});

    const err = await refusal(gw.registerClient("intruder", { registrationToken: "anything" }));

    expect(err.name).toBe(REGISTRATION_REFUSED);
  });

  it("admits only one of two callers racing on an empty engine", async () => {
    const { gateway: gw, createClient } = gateway(null, "first");

    const results = await Promise.allSettled([gw.registerClient("a", {}), gw.registerClient("b", {})]);

    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("keeps serving after a refused registration", async () => {
    const { gateway: gw } = gateway(TOKEN, "first");
    await gw.registerClient("desktop", {});
    await refusal(gw.registerClient("intruder", {}));

    const result = await gw.registerClient("dashboard", { registrationToken: TOKEN });

    expect(result.clientId).toBe("c2");
  });

  it("does not warn that registration is open", () => {
    const { logger } = gateway(null, "first");

    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe("registerClient in an explicit mode", () => {
  it("token mode admits only a caller presenting the token", async () => {
    const { gateway: gw } = gateway(TOKEN, "token");

    expect((await refusal(gw.registerClient("ui", {}))).name).toBe(REGISTRATION_REFUSED);
    expect((await gw.registerClient("ui", { registrationToken: TOKEN })).clientId).toBe("c1");
  });

  it("open mode admits every caller", async () => {
    const { gateway: gw } = gateway(null, "open");

    await gw.registerClient("a", {});
    expect((await gw.registerClient("b", {})).clientId).toBe("c2");
  });

  it("open mode warns once at startup", () => {
    const { logger } = gateway(null, "open");

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
