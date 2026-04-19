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
const addUserForToken = mock(async (_token: unknown, _scopes: string[]) => {});

mock.module("@twurple/auth", () => ({
  RefreshingAuthProvider: class {
    constructor(credentials: unknown) {
      lastRefreshingAuthCredentials = credentials;
    }

    onRefresh = mock(() => {});
    onRefreshFailure = mock(() => {});
    addUserForToken = addUserForToken;
  },
}));

const apiClientConstructCount = { n: 0 };
let lastApiClientAuth: unknown;
const getUserByName = mock(async (_opts: { name: string }) => ({ id: "b1", name: "broadcaster" }));

mock.module("@twurple/api", () => ({
  ApiClient: class {
    users = { getUserByName };

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

let TwitchClient: (typeof import("./index"))["default"];

beforeAll(async () => {
  ({ default: TwitchClient } = await import("./index"));
});

function createGetSetting(tokenJson: string | undefined) {
  const fn = mock(async (_req: { key: string; applicationId: string }) => {
    return {
      setting: {
        value: { stringValue: tokenJson },
      },
    };
  });
  return fn;
}

beforeEach(() => {
  lastRefreshingAuthCredentials = undefined;
  addUserForToken.mockClear();
  apiClientConstructCount.n = 0;
  lastApiClientAuth = undefined;
  getUserByName.mockClear();
  lastChatClientOpts = undefined;
  eventSubConstructCount.n = 0;
  lastEventSubOpts = undefined;
});

describe("TwitchClient", () => {
  test("init loads the broadcaster token from settings and registers chat scope on the auth provider", async () => {
    const getSetting = createGetSetting(TOKEN_JSON);
    const client = new TwitchClient({
      applicationId: "app-9",
      channel: "mychannel",
      getSetting,
    });

    await client.init({
      clientId: "cid",
      clientSecret: "sec",
      redirectUri: "https://app/cb",
    });

    expect(getSetting).toHaveBeenCalledWith({ applicationId: "app-9", key: "twitch_token" });
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
      applicationId: "a",
      channel: "c",
      getSetting: getSettingEmpty,
    });

    await expect(
      client.init({ clientId: "x", clientSecret: "y", redirectUri: "z" }),
    ).rejects.toThrow("Missing broadcaster token in db proxy setting: twitch_token");
  });

  test("facade methods require init before exposing Twitch surfaces", async () => {
    const client = new TwitchClient({
      applicationId: "a",
      channel: "who",
      getSetting: createGetSetting(TOKEN_JSON),
    });

    expect(() => client.ApiClient()).toThrow("Must initialize TwitchClient before use");
    expect(() => client.ChatClient()).toThrow("Must initialize TwitchClient before use");
    expect(() => client.EventBusListener()).toThrow("Must initialize TwitchClient before use");
  });

  test("ApiClient is lazily created once and reused", async () => {
    const client = new TwitchClient({
      applicationId: "a",
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
      applicationId: "a",
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
      applicationId: "a",
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
      applicationId: "a",
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
      applicationId: "a",
      channel: "ghost",
      getSetting: createGetSetting(TOKEN_JSON),
    });
    await client.init({ clientId: "i", clientSecret: "s", redirectUri: "r" });

    await expect(client.broadcaster()).rejects.toThrow("Failed to retrieve Twitch Helix user: ghost");
  });
});
