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
const addUserForToken = mock(async (_token: unknown, _scopes: string[]) => "42");

mock.module("@twurple/auth", () => ({
  RefreshingAuthProvider: class {
    constructor(credentials: unknown) {
      lastRefreshingAuthCredentials = credentials;
    }

    onRefresh = mock((handler: (userId: string, token: Record<string, unknown>) => Promise<void>) => {
      lastOnRefresh = handler;
    });
    onRefreshFailure = mock(() => {});
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

let lastChatClientOpts: unknown;
mock.module("@twurple/chat", () => ({
  ChatClient: class {
    constructor(opts: unknown) {
      lastChatClientOpts = opts;
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

function createGetSetting(tokenJson: string | undefined) {
  const fn = mock(async (_key: string) => tokenJson);
  return fn;
}

beforeEach(() => {
  lastRefreshingAuthCredentials = undefined;
  addUserForToken.mockClear();
  apiClientConstructCount.n = 0;
  lastApiClientAuth = undefined;
  getUserByName.mockClear();
  getUserById.mockClear();
  lastChatClientOpts = undefined;
  eventSubConstructCount.n = 0;
  lastEventSubOpts = undefined;
});

describe("TwitchClient", () => {
  test("init loads the broadcaster token from settings and registers chat scope on the auth provider", async () => {
    const getSetting = createGetSetting(TOKEN_JSON);
    const client = new TwitchClient({
      channel: "mychannel",
      getSetting,
    });

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
    const client = new TwitchClient({
      channel: "c",
      getSetting: getSettingEmpty,
    });

    await expect(client.init({ clientId: "x", clientSecret: "y", redirectUri: "z" })).rejects.toThrow(
      "Missing broadcaster token in db proxy setting: twitch_token"
    );
  });

  test("facade methods require init before exposing Twitch surfaces", async () => {
    const client = new TwitchClient({
      channel: "who",
      getSetting: createGetSetting(TOKEN_JSON),
    });

    expect(() => client.ApiClient()).toThrow("Must initialize TwitchClient before use");
    expect(() => client.ChatClient()).toThrow("Must initialize TwitchClient before use");
    expect(() => client.EventBusListener()).toThrow("Must initialize TwitchClient before use");
  });

  test("ApiClient is lazily created once and reused", async () => {
    const client = new TwitchClient({
      channel: "who",
      getSetting: createGetSetting(TOKEN_JSON),
    });
    await client.init({ clientId: "i", clientSecret: "s", redirectUri: "r" });

    const a = client.ApiClient();
    const b = client.ApiClient();

    expect(a).toBe(b);
    expect(apiClientConstructCount.n).toBe(1);
    expect(lastApiClientAuth).toBeDefined();
  });

  test("ChatClient is constructed for the configured channel with the authenticated session", async () => {
    const client = new TwitchClient({
      channel: "streamername",
      getSetting: createGetSetting(TOKEN_JSON),
    });
    await client.init({ clientId: "i", clientSecret: "s", redirectUri: "r" });

    client.ChatClient();

    expect(lastChatClientOpts).toMatchObject({
      channels: ["streamername"],
    });
    expect((lastChatClientOpts as { authProvider: unknown }).authProvider).toBeDefined();
  });

  test("EventSub listener is lazily created once and shares the Helix ApiClient", async () => {
    const client = new TwitchClient({
      channel: "who",
      getSetting: createGetSetting(TOKEN_JSON),
    });
    await client.init({ clientId: "i", clientSecret: "s", redirectUri: "r" });

    const e1 = client.EventBusListener();
    const e2 = client.EventBusListener();

    expect(e1).toBe(e2);
    expect(eventSubConstructCount.n).toBe(1);
    expect((lastEventSubOpts as { apiClient: unknown }).apiClient).toBe(client.ApiClient());
  });

  test("broadcaster resolves the Helix user for the configured channel name", async () => {
    const client = new TwitchClient({
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

    const client = new TwitchClient({
      channel: "ghost",
      getSetting: createGetSetting(TOKEN_JSON),
    });
    await client.init({ clientId: "i", clientSecret: "s", redirectUri: "r" });

    await expect(client.broadcaster()).rejects.toThrow("Failed to retrieve Twitch Helix user: ghost");
  });
});

describe("TwitchClient before and after a Twitch account is linked", () => {
  const credentials = { clientId: "cid", clientSecret: "sec", redirectUri: "https://app/cb" };

  test("init rejects with a TwitchNotLinked error while no token is stored", async () => {
    const { TWITCH_NOT_LINKED } = await import("./index");
    for (const stored of [undefined, "", "   "]) {
      const client = new TwitchClient({ getSetting: createGetSetting(stored) });
      const err = await client.init(credentials).then(
        () => null,
        (e: unknown) => e as Error
      );
      expect(err?.name).toBe(TWITCH_NOT_LINKED);
    }
  });

  test("without a configured channel, the broadcaster is the account that linked the token", async () => {
    const client = new TwitchClient({ getSetting: createGetSetting(TOKEN_JSON) });
    await client.init(credentials);

    const broadcaster = await client.broadcaster();

    expect(getUserById).toHaveBeenCalledWith("42");
    expect(getUserByName).not.toHaveBeenCalled();
    expect(broadcaster.name).toBe("linked-login");
  });

  test("a chat client joins the channel it is given", async () => {
    const client = new TwitchClient({ getSetting: createGetSetting(TOKEN_JSON) });
    await client.init(credentials);

    client.ChatClient("linked-login");

    expect((lastChatClientOpts as { channels: string[] }).channels).toEqual(["linked-login"]);
  });

  test("a chat client needs a channel from somewhere", async () => {
    const client = new TwitchClient({ getSetting: createGetSetting(TOKEN_JSON) });
    await client.init(credentials);

    expect(() => client.ChatClient()).toThrow("ChatClient needs a channel");
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
    const client = new TwitchClient({ channel: "c", getSetting, setSetting });
    await client.init({ clientId: "i", clientSecret: "s", redirectUri: "r" });

    await lastOnRefresh?.("42", { ...OLD, accessToken: "a1b", refreshToken: "r1b", obtainmentTimestamp: 2000 });

    expect(JSON.parse(state.value).refreshToken).toBe("r1b");

    // The next refresh builds on the one just persisted.
    await lastOnRefresh?.("42", { ...OLD, accessToken: "a1c", refreshToken: "r1c", obtainmentTimestamp: 3000 });
    expect(JSON.parse(state.value).refreshToken).toBe("r1c");
  });

  test("a refresh of the old token does not overwrite a relinked one", async () => {
    const { state, getSetting, setSetting } = store(OLD);
    const client = new TwitchClient({ channel: "c", getSetting, setSetting });
    await client.init({ clientId: "i", clientSecret: "s", redirectUri: "r" });

    state.value = JSON.stringify(RELINKED);
    await lastOnRefresh?.("42", { ...OLD, accessToken: "a1b", refreshToken: "r1b", obtainmentTimestamp: 2000 });

    expect(JSON.parse(state.value)).toEqual(RELINKED);
    expect(setSetting).not.toHaveBeenCalled();
  });

  test("reloadToken hands the relinked token to the auth provider", async () => {
    const { state, getSetting, setSetting } = store(OLD);
    const client = new TwitchClient({ channel: "c", getSetting, setSetting });
    await client.init({ clientId: "i", clientSecret: "s", redirectUri: "r" });

    state.value = JSON.stringify(RELINKED);
    expect(await client.reloadToken()).toEqual({ userId: "42", userChanged: false });
    expect(addUserForToken.mock.calls.at(-1)?.[0]).toEqual(RELINKED);

    // Refreshes of the relinked token are now the ones persisted.
    await lastOnRefresh?.("42", { ...RELINKED, refreshToken: "r2b", obtainmentTimestamp: 6000 });
    expect(JSON.parse(state.value).refreshToken).toBe("r2b");
  });

  test("reloadToken reports a relink to a different account", async () => {
    const { state, getSetting } = store(OLD);
    const client = new TwitchClient({ channel: "c", getSetting });
    await client.init({ clientId: "i", clientSecret: "s", redirectUri: "r" });

    state.value = JSON.stringify({ ...RELINKED, userId: "99" });
    addUserForToken.mockImplementationOnce(async () => "99");

    expect(await client.reloadToken()).toEqual({ userId: "99", userChanged: true });
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
    const client = new TwitchClient({ getSetting: createGetSetting(JSON.stringify(FROM_DASHBOARD)), requestToken });
    const provider = await client.init();

    expect(provider.clientId).toBe("woofx3-app");
    expect(lastRefreshingAuthCredentials).toBeUndefined();
    expect(addUserForToken).not.toHaveBeenCalled();
    expect((await client.broadcaster()).id).toBe("42");
  });

  test("needs a way to ask the dashboard", async () => {
    const client = new TwitchClient({ getSetting: createGetSetting(JSON.stringify(FROM_DASHBOARD)) });
    await expect(client.init()).rejects.toThrow("no requestToken");
  });

  test("a relinked dashboard token replaces the one the provider holds", async () => {
    const state = { value: JSON.stringify(FROM_DASHBOARD) };
    const client = new TwitchClient({
      getSetting: mock(async () => state.value),
      requestToken: mock(async () => ({ ...FROM_DASHBOARD, refreshToken: null })),
    });
    const provider = await client.init();

    state.value = JSON.stringify({ ...FROM_DASHBOARD, accessToken: "a2", userId: "99" });
    expect(await client.reloadToken()).toEqual({ userId: "99", userChanged: true });
    expect((await provider.getAnyAccessToken()).accessToken).toBe("a2");
  });
});

describe("a token not from a dashboard", () => {
  test("needs Twitch app credentials to refresh it", async () => {
    const client = new TwitchClient({ getSetting: createGetSetting(TOKEN_JSON) });
    await expect(client.init()).rejects.toThrow("no Twitch app credentials");
  });
});
