import { describe, expect, mock, test } from "bun:test";
import { AUTH_UNAVAILABLE, isAuthenticationRefused, refusalReason } from "@woofx3/api/rpc";
import { type AuthResult, ClientAuth, DEFAULT_AUTH_CACHE_TTL_MS } from "../src/auth";
import { resolveAuthCacheTtlMs, resolvePlatformGatewayTimeoutMs } from "../src/config";
import { ApiGateway } from "../src/gateway";
import { resolveRegistrationPolicy } from "../src/registration";

const RIGHT = "right-secret";
const WRONG = "wrong-secret";
const TTL_MS = 1_000;

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as never as ConstructorParameters<typeof ClientAuth>[1];
}

/**
 * A db proxy that knows every client id with RIGHT as its secret. Setting
 * `down` makes the next calls throw, as an unreachable proxy does.
 */
function fakeDb() {
  const state = { down: false, deleted: new Set<string>() };
  const validateClient = mock(async (clientId: string, clientSecret: string) => {
    if (state.down) {
      throw new Error("connect ECONNREFUSED");
    }
    if (clientSecret !== RIGHT || state.deleted.has(clientId)) {
      return { status: { code: "NOT_FOUND", message: "Invalid credentials" } };
    }
    return {
      status: { code: "OK" },
      client: { clientId, description: `client ${clientId}`, callbackUrl: "", callbackToken: "" },
    };
  });
  return { state, validateClient, db: { validateClient } as never };
}

function harness() {
  const clock = { now: 0 };
  const { state, validateClient, db } = fakeDb();
  const auth = new ClientAuth(db, fakeLogger(), { ttlMs: TTL_MS, now: () => clock.now });
  return { auth, clock, state, validateClient };
}

type Harness = ReturnType<typeof harness>;
type Outcome = "valid" | "invalid_credentials" | "auth_unavailable";

function outcome(result: AuthResult): Outcome {
  return result.ok ? "valid" : result.error.kind;
}

interface Case {
  name: string;
  /** Run before the checked call; may itself validate. */
  arrange: (h: Harness) => Promise<void>;
  secret: string;
  expected: Outcome;
  /** Total db proxy calls once the checked call has returned. */
  dbCalls: number;
}

const cases: Case[] = [
  {
    name: "a wrong secret after a right one is invalid",
    arrange: async ({ auth }) => {
      expect(outcome(await auth.validate("c1", RIGHT))).toBe("valid");
    },
    secret: WRONG,
    expected: "invalid_credentials",
    dbCalls: 2,
  },
  {
    name: "a right secret after a wrong one is valid",
    arrange: async ({ auth }) => {
      expect(outcome(await auth.validate("c1", WRONG))).toBe("invalid_credentials");
    },
    secret: RIGHT,
    expected: "valid",
    dbCalls: 2,
  },
  {
    name: "a repeated right secret is served from the cache",
    arrange: async ({ auth }) => {
      await auth.validate("c1", RIGHT);
    },
    secret: RIGHT,
    expected: "valid",
    dbCalls: 1,
  },
  {
    name: "an unreachable db proxy is auth_unavailable and not cached",
    arrange: async ({ auth, state }) => {
      state.down = true;
      expect(outcome(await auth.validate("c1", RIGHT))).toBe("auth_unavailable");
      state.down = false;
    },
    secret: RIGHT,
    expected: "valid",
    dbCalls: 2,
  },
  {
    name: "invalidateCache drops the client's cached success",
    arrange: async ({ auth, state }) => {
      await auth.validate("c1", RIGHT);
      state.deleted.add("c1");
      auth.invalidateCache("c1");
    },
    secret: RIGHT,
    expected: "invalid_credentials",
    dbCalls: 2,
  },
  {
    name: "a cached success expires after the TTL",
    arrange: async ({ auth, state, clock }) => {
      await auth.validate("c1", RIGHT);
      state.deleted.add("c1");
      clock.now += TTL_MS;
    },
    secret: RIGHT,
    expected: "invalid_credentials",
    dbCalls: 2,
  },
  {
    name: "a cached success holds until the TTL",
    arrange: async ({ auth, state, clock }) => {
      await auth.validate("c1", RIGHT);
      state.deleted.add("c1");
      clock.now += TTL_MS - 1;
    },
    secret: RIGHT,
    expected: "valid",
    dbCalls: 1,
  },
  {
    name: "an empty secret is invalid without asking the db proxy",
    arrange: async () => {},
    secret: "",
    expected: "invalid_credentials",
    dbCalls: 0,
  },
];

describe("ClientAuth.validate", () => {
  for (const c of cases) {
    test(c.name, async () => {
      const h = harness();
      await c.arrange(h);

      expect(outcome(await h.auth.validate("c1", c.secret))).toBe(c.expected);
      expect(h.validateClient).toHaveBeenCalledTimes(c.dbCalls);
    });
  }

  test("invalidateCache leaves other clients cached", async () => {
    const h = harness();
    await h.auth.validate("c1", RIGHT);
    await h.auth.validate("c2", RIGHT);

    h.auth.invalidateCache("c1");
    h.state.down = true;

    expect(outcome(await h.auth.validate("c1", RIGHT))).toBe("auth_unavailable");
    expect(outcome(await h.auth.validate("c2", RIGHT))).toBe("valid");
  });

  test("invalidateCache during an in-flight check keeps its success out of the cache", async () => {
    const h = harness();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const answer = h.validateClient.getMockImplementation();
    if (!answer) {
      throw new Error("fake db has no implementation");
    }
    h.validateClient.mockImplementationOnce(async (clientId: string, clientSecret: string) => {
      const response = await answer(clientId, clientSecret);
      await gate;
      return response;
    });

    const pending = h.auth.validate("c1", RIGHT);
    h.state.deleted.add("c1");
    h.auth.invalidateCache("c1");
    release();
    // The db proxy answered before the delete, so this one check still passes.
    expect(outcome(await pending)).toBe("valid");

    expect(outcome(await h.auth.validate("c1", RIGHT))).toBe("invalid_credentials");
    expect(h.validateClient).toHaveBeenCalledTimes(2);
  });

  test("caching a success drops the client's expired entries", async () => {
    const h = harness();
    const other = "other-secret";
    const answer = h.validateClient.getMockImplementation();
    if (!answer) {
      throw new Error("fake db has no implementation");
    }
    h.validateClient.mockImplementationOnce(async (clientId: string) => answer(clientId, RIGHT));
    await h.auth.validate("c1", other);
    h.clock.now += TTL_MS;

    await h.auth.validate("c1", RIGHT);

    expect(h.auth["cache"].size).toBe(1);
    expect(h.auth["keysByClient"].get("c1")?.size).toBe(1);
  });

  test("a db proxy answer that is not a verdict is auth_unavailable and not cached", async () => {
    const h = harness();
    h.validateClient.mockImplementationOnce(async () => ({
      status: { code: "INTERNAL", message: "database is locked" },
    }));

    expect(outcome(await h.auth.validate("c1", RIGHT))).toBe("auth_unavailable");
    expect(outcome(await h.auth.validate("c1", RIGHT))).toBe("valid");
    expect(h.validateClient).toHaveBeenCalledTimes(2);
  });

  test("refuses a TTL that is not a positive integer", () => {
    const { db } = fakeDb();
    for (const ttlMs of [0, -1, 1.5, Number.NaN]) {
      expect(() => new ClientAuth(db, fakeLogger(), { ttlMs })).toThrow("ttlMs must be a positive integer");
    }
  });
});

describe("ApiGateway.authenticate", () => {
  function gateway(down: boolean) {
    const { state, db } = fakeDb();
    state.down = down;
    const logger = fakeLogger();
    const auth = new ClientAuth(db, logger, { ttlMs: TTL_MS });
    return new ApiGateway({} as never, auth, db, logger, resolveRegistrationPolicy({ mode: "first" }));
  }

  async function rejection(promise: Promise<unknown>): Promise<Error> {
    try {
      await promise;
    } catch (err) {
      return err as Error;
    }
    throw new Error("expected authenticate to reject");
  }

  test("rejects a wrong secret as invalid credentials", async () => {
    const err = await rejection(gateway(false).authenticate("c1", WRONG));

    expect(isAuthenticationRefused(err)).toBe(true);
    expect(refusalReason(err)).toBe("Invalid client credentials");
  });

  test("rejects with a retryable AuthUnavailable when the db proxy is down", async () => {
    const err = await rejection(gateway(true).authenticate("c1", RIGHT));

    expect(err.name).toBe(AUTH_UNAVAILABLE);
    expect(isAuthenticationRefused(err)).toBe(false);
    expect(err.message).not.toContain("Invalid client credentials");
  });
});

describe("resolveAuthCacheTtlMs", () => {
  const valid: [unknown, number][] = [
    [undefined, DEFAULT_AUTH_CACHE_TTL_MS],
    ["", DEFAULT_AUTH_CACHE_TTL_MS],
    ["  ", DEFAULT_AUTH_CACHE_TTL_MS],
    [5_000, 5_000],
    ["250", 250],
  ];
  for (const [value, expected] of valid) {
    test(`${JSON.stringify(value)} resolves to ${expected}`, () => {
      expect(resolveAuthCacheTtlMs(value)).toBe(expected);
    });
  }

  for (const value of ["0", "-5", "1.5", "soon", 0]) {
    test(`${JSON.stringify(value)} stops startup`, () => {
      expect(() => resolveAuthCacheTtlMs(value)).toThrow("WOOFX3_AUTH_CACHE_TTL_MS");
    });
  }
});

describe("resolvePlatformGatewayTimeoutMs", () => {
  const valid: [unknown, number][] = [
    [undefined, 12_000],
    ["", 12_000],
    ["  ", 12_000],
    [20_000, 20_000],
    ["15000", 15_000],
  ];
  for (const [value, expected] of valid) {
    test(`${JSON.stringify(value)} resolves to ${expected}`, () => {
      expect(resolvePlatformGatewayTimeoutMs(value)).toBe(expected);
    });
  }

  for (const value of ["0", "-5", "1.5", "soon", 0]) {
    test(`${JSON.stringify(value)} stops startup`, () => {
      expect(() => resolvePlatformGatewayTimeoutMs(value)).toThrow("WOOFX3_PLATFORM_GATEWAY_TIMEOUT_MS");
    });
  }
});
