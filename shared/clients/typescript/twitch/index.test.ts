import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

/** Minimal token JSON Twurple accepts after parse (shape only; real validation is in the library). */
const TOKEN_JSON = JSON.stringify({
  accessToken: "access",
  refreshToken: "refresh",
  expiresIn: 3600,
  obtainmentTimestamp: Date.now(),
  userId: "42",
});

let lastRefreshingAuthCredentials: unknown;
let lastOnRefresh: ((userId: string, token: Record<string, unknown>) => Promise<void>) | undefined;
let lastOnRefreshFailure: ((userId: string, error: Error) => void) | undefined;
const addUserForToken = mock(async (_token: unknown, _scopes: string[]) => "42");

mock.module("@twurple/auth", () => ({
  RefreshingAuthProvider: class {
    constructor(credentials: unknown) {
      lastRefreshingAuthCredentials = credentials;
    }

    onRefresh = mock((handler: (userId: string, token: Record<string, unknown>) => Promise<void>) => {
      lastOnRefresh = handler;
    });
    onRefreshFailure = mock((handler: (userId: string, error: Error) => void) => {
      lastOnRefreshFailure = handler;
    });
    addUserForToken = addUserForToken;
  },
}));

const apiClientConstructCount = { n: 0 };
let lastApiClientAuth: unknown;
const getUserByName = mock(async (_opts: { name: string }) => ({ id: "b1", name: "broadcaster" }));
const getUserById = mock(async (id: string) => ({ id, name: "linked-login" }));

mock.module("@twurple/api", () => ({
  ApiClient: class {
    users = { getUserByName, getUserById };

    constructor(opts: { authProvider: unknown }) {
      apiClientConstructCount.n += 1;
      lastApiClientAuth = opts.authProvider;
    }
  },
}));

const eventSubConstructCount = { n: 0 };
let lastEventSubOpts: unknown;
mock.module("@twurple/eventsub-ws", () => ({
  EventSubWsListener: class {
    constructor(opts: unknown) {
      eventSubConstructCount.n += 1;
      lastEventSubOpts = opts;
    }
  },
}));

let TwitchClient: typeof import("./index")["default"];

beforeAll(async () => {
  ({ default: TwitchClient } = await import("./index"));
});

type LogLevel = "debug" | "info" | "warn" | "error";
type LogEntry = { level: LogLevel; message: string; metadata?: Record<string, unknown> };

/** Every line the client logged since the last reset. */
const logged: LogEntry[] = [];
const record = (level: LogLevel) => (message: string, metadata?: Record<string, unknown>) => {
  logged.push({ level, message, metadata });
};
const LOGGER = { debug: record("debug"), info: record("info"), warn: record("warn"), error: record("error") };

const CREDENTIALS = { clientId: "cid", clientSecret: "sec", redirectUri: "https://app/cb" };

function createGetSetting(tokenJson: string | undefined) {
  const fn = mock(async (_key: string) => tokenJson);
  return fn;
}

beforeEach(() => {
  logged.length = 0;
  lastOnRefreshFailure = undefined;
  lastRefreshingAuthCredentials = undefined;
  addUserForToken.mockClear();
  apiClientConstructCount.n = 0;
  lastApiClientAuth = undefined;
  getUserByName.mockClear();
  getUserById.mockClear();
  eventSubConstructCount.n = 0;
  lastEventSubOpts = undefined;
});

describe("TwitchClient", () => {
  test("init loads the broadcaster token from settings and registers chat scope on the auth provider", async () => {
    const getSetting = createGetSetting(TOKEN_JSON);
    const client = new TwitchClient({ logger: LOGGER, channel: "mychannel", getSetting });

    await client.init({
      clientId: "cid",
      clientSecret: "sec",
      redirectUri: "https://app/cb",
    });

    expect(getSetting).toHaveBeenCalledWith("twitch_token");
    expect(lastRefreshingAuthCredentials).toEqual({
      clientId: "cid",
      clientSecret: "sec",
      redirectUri: "https://app/cb",
    });
    expect(addUserForToken).toHaveBeenCalledTimes(1);
    const first = addUserForToken.mock.calls[0];
    expect(first).toBeDefined();
    expect(first?.[1]).toEqual(["chat"]);
    expect(first?.[0]).toEqual(JSON.parse(TOKEN_JSON));
  });

  test("init fails fast when twitch_token is missing or empty in settings", async () => {
    const getSettingEmpty = createGetSetting(undefined);
    const client = new TwitchClient({ logger: LOGGER, channel: "c", getSetting: getSettingEmpty });

    await expect(client.init({ clientId: "x", clientSecret: "y", redirectUri: "z" })).rejects.toThrow(
      "Missing broadcaster token in db proxy setting: twitch_token"
    );
  });

  test("init gives up on an aborted signal without asking for the token", async () => {
    const getSetting = createGetSetting(TOKEN_JSON);
    const client = new TwitchClient({ logger: LOGGER, channel: "c", getSetting });
    const reason = new Error("stopped");

    await expect(client.init(CREDENTIALS, AbortSignal.abort(reason))).rejects.toBe(reason);

    expect(getSetting).not.toHaveBeenCalled();
  });

  test("init aborted while reading the token registers nothing and stays uninitialized", async () => {
    const abort = new AbortController();
    const reason = new Error("stopped");
    const getSetting = mock(async (_key: string) => {
      abort.abort(reason);
      return TOKEN_JSON;
    });
    const client = new TwitchClient({ logger: LOGGER, channel: "c", getSetting });

    await expect(client.init(CREDENTIALS, abort.signal)).rejects.toBe(reason);

    expect(addUserForToken).not.toHaveBeenCalled();
    expect(() => client.ApiClient()).toThrow("Must initialize TwitchClient before use");
  });

  test("init aborted while registering the token stays uninitialized", async () => {
    const abort = new AbortController();
    const reason = new Error("stopped");
    addUserForToken.mockImplementationOnce(async () => {
      abort.abort(reason);
      return "42";
    });
    const client = new TwitchClient({ logger: LOGGER, channel: "c", getSetting: createGetSetting(TOKEN_JSON) });

    await expect(client.init(CREDENTIALS, abort.signal)).rejects.toBe(reason);

    expect(() => client.ApiClient()).toThrow("Must initialize TwitchClient before use");
  });

  test("facade methods require init before exposing Twitch surfaces", async () => {
    const client = new TwitchClient({ logger: LOGGER, channel: "who", getSetting: createGetSetting(TOKEN_JSON) });

    expect(() => client.ApiClient()).toThrow("Must initialize TwitchClient before use");
    expect(() => client.EventBusListener()).toThrow("Must initialize TwitchClient before use");
  });

  test("ApiClient is lazily created once and reused", async () => {
    const client = new TwitchClient({ logger: LOGGER, channel: "who", getSetting: createGetSetting(TOKEN_JSON) });
    await client.init({ clientId: "i", clientSecret: "s", redirectUri: "r" });

    const a = client.ApiClient();
    const b = client.ApiClient();

    expect(a).toBe(b);
    expect(apiClientConstructCount.n).toBe(1);
    expect(lastApiClientAuth).toBeDefined();
  });

  test("EventSub listener is lazily created once and shares the Helix ApiClient", async () => {
    const client = new TwitchClient({ logger: LOGGER, channel: "who", getSetting: createGetSetting(TOKEN_JSON) });
    await client.init({ clientId: "i", clientSecret: "s", redirectUri: "r" });

    const e1 = client.EventBusListener();
    const e2 = client.EventBusListener();

    expect(e1).toBe(e2);
    expect(eventSubConstructCount.n).toBe(1);
    expect((lastEventSubOpts as { apiClient: unknown }).apiClient).toBe(client.ApiClient());
  });

  test("broadcaster resolves the Helix user for the configured channel name", async () => {
    const client = new TwitchClient({
      logger: LOGGER,
      channel: "DisplayName",
      getSetting: createGetSetting(TOKEN_JSON),
    });
    await client.init({ clientId: "i", clientSecret: "s", redirectUri: "r" });

    const user = await client.broadcaster();

    expect(getUserByName).toHaveBeenCalledWith({ name: "DisplayName" });
    expect(user).toEqual({ id: "b1", name: "broadcaster" });
  });

  test("broadcaster surfaces a clear error when Helix has no user for that name", async () => {
    getUserByName.mockImplementationOnce(async () => null);

    const client = new TwitchClient({ logger: LOGGER, channel: "ghost", getSetting: createGetSetting(TOKEN_JSON) });
    await client.init({ clientId: "i", clientSecret: "s", redirectUri: "r" });

    await expect(client.broadcaster()).rejects.toThrow("Failed to retrieve Twitch Helix user: ghost");
  });
});

describe("TwitchClient before and after a Twitch account is linked", () => {
  const credentials = { clientId: "cid", clientSecret: "sec", redirectUri: "https://app/cb" };

  test("init rejects with a TwitchNotLinked error while no token is stored", async () => {
    const { TWITCH_NOT_LINKED } = await import("./index");
    for (const stored of [undefined, "", "   "]) {
      const client = new TwitchClient({ logger: LOGGER, getSetting: createGetSetting(stored) });
      const err = await client.init(credentials).then(
        () => null,
        (e: unknown) => e as Error
      );
      expect(err?.name).toBe(TWITCH_NOT_LINKED);
    }
  });

  test("without a configured channel, the broadcaster is the account that linked the token", async () => {
    const client = new TwitchClient({ logger: LOGGER, getSetting: createGetSetting(TOKEN_JSON) });
    await client.init(credentials);

    const broadcaster = await client.broadcaster();

    expect(getUserById).toHaveBeenCalledWith("42");
    expect(getUserByName).not.toHaveBeenCalled();
    expect(broadcaster.name).toBe("linked-login");
  });
});

describe("token relink", () => {
  const OLD = { accessToken: "a1", refreshToken: "r1", expiresIn: 3600, obtainmentTimestamp: 1000, userId: "42" };
  const RELINKED = { accessToken: "a2", refreshToken: "r2", expiresIn: 3600, obtainmentTimestamp: 5000, userId: "42" };

  /** A settings store the tests can change underneath the client, as a relink does. */
  function store(initial: object) {
    const state = { value: JSON.stringify(initial) };
    const getSetting = mock(async (_key: string) => state.value);
    const setSetting = mock(async (_key: string, value: string) => {
      state.value = value;
    });
    return { state, getSetting, setSetting };
  }

  test("a refresh of the loaded token is persisted", async () => {
    const { state, getSetting, setSetting } = store(OLD);
    const client = new TwitchClient({ logger: LOGGER, channel: "c", getSetting, setSetting });
    await client.init({ clientId: "i", clientSecret: "s", redirectUri: "r" });

    await lastOnRefresh?.("42", { ...OLD, accessToken: "a1b", refreshToken: "r1b", obtainmentTimestamp: 2000 });

    expect(JSON.parse(state.value).refreshToken).toBe("r1b");

    // The next refresh builds on the one just persisted.
    await lastOnRefresh?.("42", { ...OLD, accessToken: "a1c", refreshToken: "r1c", obtainmentTimestamp: 3000 });
    expect(JSON.parse(state.value).refreshToken).toBe("r1c");
  });

  test("a refresh of the old token does not overwrite a relinked one", async () => {
    const { state, getSetting, setSetting } = store(OLD);
    const client = new TwitchClient({ logger: LOGGER, channel: "c", getSetting, setSetting });
    await client.init({ clientId: "i", clientSecret: "s", redirectUri: "r" });

    state.value = JSON.stringify(RELINKED);
    await lastOnRefresh?.("42", { ...OLD, accessToken: "a1b", refreshToken: "r1b", obtainmentTimestamp: 2000 });

    expect(JSON.parse(state.value)).toEqual(RELINKED);
    expect(setSetting).not.toHaveBeenCalled();
  });

  test("reloadToken hands the relinked token to the auth provider", async () => {
    const { state, getSetting, setSetting } = store(OLD);
    const client = new TwitchClient({ logger: LOGGER, channel: "c", getSetting, setSetting });
    await client.init({ clientId: "i", clientSecret: "s", redirectUri: "r" });

    state.value = JSON.stringify(RELINKED);
    expect(await client.reloadToken()).toEqual({ userId: "42", userChanged: false, providerChanged: false });
    expect(addUserForToken.mock.calls.at(-1)?.[0]).toEqual(RELINKED);

    // Refreshes of the relinked token are now the ones persisted.
    await lastOnRefresh?.("42", { ...RELINKED, refreshToken: "r2b", obtainmentTimestamp: 6000 });
    expect(JSON.parse(state.value).refreshToken).toBe("r2b");
  });

  test("reloadToken reports a relink to a different account", async () => {
    const { state, getSetting } = store(OLD);
    const client = new TwitchClient({ logger: LOGGER, channel: "c", getSetting });
    await client.init({ clientId: "i", clientSecret: "s", redirectUri: "r" });

    state.value = JSON.stringify({ ...RELINKED, userId: "99" });
    addUserForToken.mockImplementationOnce(async () => "99");

    expect(await client.reloadToken()).toEqual({ userId: "99", userChanged: true, providerChanged: false });
  });
});

describe("a token from a dashboard", () => {
  const FROM_DASHBOARD = {
    accessToken: "a1",
    scope: ["chat:read"],
    expiresIn: 3600,
    obtainmentTimestamp: Date.now(),
    userId: "42",
    clientId: "woofx3-app",
  };

  test("is served by a provider that asks the dashboard, with no app credentials", async () => {
    const requestToken = mock(async () => ({ ...FROM_DASHBOARD, refreshToken: null }));
    const client = new TwitchClient({
      logger: LOGGER,
      getSetting: createGetSetting(JSON.stringify(FROM_DASHBOARD)),
      requestToken,
    });
    const provider = await client.init();

    expect(provider.clientId).toBe("woofx3-app");
    expect(lastRefreshingAuthCredentials).toBeUndefined();
    expect(addUserForToken).not.toHaveBeenCalled();
    expect((await client.broadcaster()).id).toBe("42");
  });

  test("needs a way to ask the dashboard", async () => {
    const client = new TwitchClient({ logger: LOGGER, getSetting: createGetSetting(JSON.stringify(FROM_DASHBOARD)) });
    await expect(client.init()).rejects.toThrow("no requestToken");
  });

  test("a relinked dashboard token replaces the one the provider holds", async () => {
    const state = { value: JSON.stringify(FROM_DASHBOARD) };
    const client = new TwitchClient({
      logger: LOGGER,
      getSetting: mock(async () => state.value),
      requestToken: mock(async () => ({ ...FROM_DASHBOARD, refreshToken: null })),
    });
    const provider = await client.init();

    state.value = JSON.stringify({ ...FROM_DASHBOARD, accessToken: "a2", userId: "99" });
    expect(await client.reloadToken()).toEqual({ userId: "99", userChanged: true, providerChanged: false });
    expect((await provider.getAnyAccessToken()).accessToken).toBe("a2");
  });
});

describe("a token not from a dashboard", () => {
  test("needs Twitch app credentials to refresh it", async () => {
    const client = new TwitchClient({ logger: LOGGER, getSetting: createGetSetting(TOKEN_JSON) });
    await expect(client.init()).rejects.toThrow("no Twitch app credentials");
  });
});

describe("a token from the engine's public Twitch app", () => {
  const FROM_DEVICE_LOGIN = {
    accessToken: "a1",
    refreshToken: "r1",
    scope: ["chat:read"],
    expiresIn: 3600,
    obtainmentTimestamp: Date.now(),
    userId: "42",
    publicClientId: "public-app",
  };

  test("is served by a provider that asks the api service, never refreshed here", async () => {
    const requestToken = mock(async () => ({ ...FROM_DEVICE_LOGIN, refreshToken: null, clientId: "public-app" }));
    const client = new TwitchClient({
      logger: LOGGER,
      getSetting: createGetSetting(JSON.stringify(FROM_DEVICE_LOGIN)),
      requestToken,
    });
    const provider = await client.init({
      clientId: "own-app",
      clientSecret: "secret",
      redirectUri: "http://localhost",
    });

    expect(provider.clientId).toBe("public-app");
    expect(lastRefreshingAuthCredentials).toBeUndefined();
    const served = await provider.getAnyAccessToken();
    expect(served.accessToken).toBe("a1");
    // The single-use refresh token stays with the api service.
    expect(served.refreshToken).toBeNull();
    expect(requestToken).not.toHaveBeenCalled();
  });

  test("needs a way to ask the api service", async () => {
    const client = new TwitchClient({
      logger: LOGGER,
      getSetting: createGetSetting(JSON.stringify(FROM_DEVICE_LOGIN)),
    });
    await expect(client.init()).rejects.toThrow("no requestToken");
  });
});

describe("a relink to a token renewed another way", () => {
  const CONFIDENTIAL = {
    accessToken: "a1",
    refreshToken: "r1",
    scope: ["chat:read"],
    expiresIn: 3600,
    obtainmentTimestamp: Date.now(),
    userId: "42",
  };
  const FROM_DEVICE_LOGIN = { ...CONFIDENTIAL, refreshToken: "r2", publicClientId: "public-app" };
  const FROM_DASHBOARD = { ...CONFIDENTIAL, refreshToken: undefined, clientId: "woofx3-app" };

  test.each([
    ["the confidential app's", "a device login's", CONFIDENTIAL, FROM_DEVICE_LOGIN],
    ["the confidential app's", "a dashboard's", CONFIDENTIAL, FROM_DASHBOARD],
    ["a device login's", "the confidential app's", FROM_DEVICE_LOGIN, CONFIDENTIAL],
    ["a dashboard's", "the confidential app's", FROM_DASHBOARD, CONFIDENTIAL],
  ])("from %s to %s reports a provider change and applies nothing", async (_, __, loaded, relinked) => {
    const state = { value: JSON.stringify(loaded) };
    const requestToken = mock(async () => ({ ...FROM_DASHBOARD, refreshToken: null }));
    const client = new TwitchClient({ logger: LOGGER, getSetting: mock(async () => state.value), requestToken });
    await client.init({ clientId: "own-app", clientSecret: "secret", redirectUri: "http://localhost" });
    const addedBefore = addUserForToken.mock.calls.length;

    state.value = JSON.stringify(relinked);
    expect(await client.reloadToken()).toEqual({ userId: "42", userChanged: false, providerChanged: true });
    expect(addUserForToken.mock.calls.length).toBe(addedBefore);
  });

  test("between a device login's and a dashboard's is a token swap", async () => {
    const state = { value: JSON.stringify(FROM_DEVICE_LOGIN) };
    const client = new TwitchClient({
      logger: LOGGER,
      getSetting: mock(async () => state.value),
      requestToken: mock(async () => ({ ...FROM_DASHBOARD, refreshToken: null })),
    });
    const provider = await client.init();

    state.value = JSON.stringify({ ...FROM_DASHBOARD, accessToken: "a2" });
    expect(await client.reloadToken()).toEqual({ userId: "42", userChanged: false, providerChanged: false });
    expect((await provider.getAnyAccessToken()).accessToken).toBe("a2");
  });
});

describe("a failed token renewal", () => {
  const FROM_DASHBOARD = {
    accessToken: "a1",
    scope: ["chat:read"],
    expiresIn: 3600,
    // Expired, so the provider asks the api service for a new token on first use.
    obtainmentTimestamp: Date.now() - 7_200_000,
    userId: "42",
    clientId: "woofx3-app",
  };

  test("a refresh Twitch refused is logged and reported as the refreshing provider's", async () => {
    const onAuthFailure = mock((_error: Error, _info: { provider: string }) => {});
    const client = new TwitchClient({ logger: LOGGER, getSetting: createGetSetting(TOKEN_JSON), onAuthFailure });
    await client.init(CREDENTIALS);

    const refused = new Error("Invalid refresh token");
    lastOnRefreshFailure?.("42", refused);

    expect(onAuthFailure.mock.calls).toEqual([[refused, { provider: "refreshing" }]]);
    expect(logged).toContainEqual({
      level: "warn",
      message: "twitch token renewal failed",
      metadata: { provider: "refreshing", userId: "42", err: "Invalid refresh token" },
    });
  });

  test.each([
    ["the api service is unreachable", new Error("TIMEOUT")],
    ["the api service refuses", new Error("the api service could not get a Twitch token: relink_required")],
  ])("is reported as the dashboard provider's when %s", async (_, failure) => {
    const onAuthFailure = mock((_error: Error, _info: { provider: string }) => {});
    const client = new TwitchClient({
      logger: LOGGER,
      getSetting: createGetSetting(JSON.stringify(FROM_DASHBOARD)),
      requestToken: mock(async () => {
        throw failure;
      }),
      onAuthFailure,
    });
    const provider = await client.init();

    await expect(provider.getAnyAccessToken()).rejects.toThrow(failure.message);

    expect(onAuthFailure.mock.calls).toEqual([[failure, { provider: "dashboard" }]]);
    expect(logged.map((entry) => [entry.level, entry.message])).toContainEqual(["warn", "twitch token renewal failed"]);
  });

  test("without a handler is still logged", async () => {
    const client = new TwitchClient({ logger: LOGGER, getSetting: createGetSetting(TOKEN_JSON) });
    await client.init(CREDENTIALS);

    lastOnRefreshFailure?.("42", new Error("Invalid refresh token"));

    expect(logged.map((entry) => entry.level)).toEqual(["warn"]);
  });
});

describe("logging", () => {
  const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const;

  test("goes to the injected logger, never the console, on every refresh path", async () => {
    const consoleCalls: string[] = [];
    const originals = CONSOLE_METHODS.map((method) => [method, console[method]] as const);
    for (const method of CONSOLE_METHODS) {
      console[method] = () => {
        consoleCalls.push(method);
      };
    }
    try {
      const state = { value: TOKEN_JSON };
      const failWrites = { on: false };
      const client = new TwitchClient({
        logger: LOGGER,
        getSetting: mock(async () => state.value),
        setSetting: mock(async (_key: string, value: string) => {
          if (failWrites.on) {
            throw new Error("db-proxy down");
          }
          state.value = value;
        }),
      });
      await client.init(CREDENTIALS);
      const loaded = JSON.parse(TOKEN_JSON);

      await lastOnRefresh?.("42", { ...loaded, obtainmentTimestamp: loaded.obtainmentTimestamp + 1 });
      failWrites.on = true;
      await lastOnRefresh?.("42", { ...loaded, obtainmentTimestamp: loaded.obtainmentTimestamp + 2 });
      state.value = JSON.stringify({ ...loaded, refreshToken: "relinked" });
      await lastOnRefresh?.("42", { ...loaded, obtainmentTimestamp: loaded.obtainmentTimestamp + 3 });
      lastOnRefreshFailure?.("42", new Error("Invalid refresh token"));

      expect(consoleCalls).toEqual([]);
      expect(logged.map((entry) => [entry.level, entry.message])).toEqual([
        ["debug", "twitch token refreshed"],
        ["debug", "twitch token refreshed"],
        ["error", "failed to persist refreshed twitch_token"],
        ["debug", "twitch token refreshed"],
        [
          "warn",
          "twitch_token changed since it was loaded (relinked?); not overwriting it with a refresh of the old token",
        ],
        ["warn", "twitch token renewal failed"],
      ]);
    } finally {
      for (const [method, original] of originals) {
        console[method] = original;
      }
    }
  });
});
