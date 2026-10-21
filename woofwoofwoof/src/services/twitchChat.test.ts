import { beforeEach, describe, expect, mock, test } from "bun:test";

/** The account the bot speaks as: the user of the token handed out for the chat intent. */
const SPEAKER_ID = "42";

const chatAuthProvider = {
  getAccessTokenForIntent: async (_intent: string) => ({ userId: SPEAKER_ID }),
};
const initMock = mock(async (): Promise<unknown> => chatAuthProvider);
const chatConnectMock = mock(() => {});
const chatQuitMock = mock(() => {});
const chatSayMock = mock(async (_channel: string, _text: string, _opts?: unknown) => {});

let lastConstructedArgs: unknown;

mock.module("@woofx3/twitch", () => ({
  __esModule: true,
  default: class TwitchClientMock {
    constructor(args: unknown) {
      lastConstructedArgs = args;
    }
    init = initMock;
    ChatClient() {
      return { connect: chatConnectMock, quit: chatQuitMock, say: chatSayMock };
    }
    broadcaster = async () => ({ id: SPEAKER_ID, name: "linked-login" });
  },
}));

const { default: TwitchChatClientService } = await import("./twitchChat");
const { DEFAULT_SENT_LINE_CONFIG, SentLineRegistry } = await import("../sentLines");

function sentLines() {
  return new SentLineRegistry(DEFAULT_SENT_LINE_CONFIG, () => 0);
}

const noDashboard = async (): Promise<never> => {
  throw new Error("no dashboard in this test");
};

describe("TwitchChatClientService", () => {
  beforeEach(() => {
    initMock.mockClear();
    chatConnectMock.mockClear();
    chatQuitMock.mockClear();
    lastConstructedArgs = undefined;
  });

  test("starts disconnected and exposes stable service identity for health/runtime", () => {
    const svc = new TwitchChatClientService({
      channel: "chan",
      credentials: { clientId: "c", clientSecret: "s", redirectUri: "http://localhost" },
      requestToken: noDashboard,
      getSetting: async () => undefined,
      sentLines: sentLines(),
    });

    expect(svc.name).toBe("twitchchat");
    expect(svc.type).toBe("twitchchat");
    expect(svc.connected).toBe(false);
    expect(svc.healthcheck).toBe(false);
  });

  test("connect wires Twitch client with channel and settings resolver, then marks healthy and connected", async () => {
    const getSetting = mock(async (_key: string): Promise<string | undefined> => undefined);
    const svc = new TwitchChatClientService({
      channel: "mychannel",
      credentials: { clientId: "cid", clientSecret: "sec", redirectUri: "http://r" },
      requestToken: noDashboard,
      getSetting,
      sentLines: sentLines(),
    });

    await svc.connect();

    expect(lastConstructedArgs).toEqual({
      channel: "mychannel",
      getSetting,
      requestToken: noDashboard,
    });
    expect(initMock).toHaveBeenCalledWith({
      clientId: "cid",
      clientSecret: "sec",
      redirectUri: "http://r",
    });
    expect(chatConnectMock).toHaveBeenCalledTimes(1);
    expect(svc.connected).toBe(true);
    expect(svc.healthcheck).toBe(true);
  });

  test("connect is idempotent: does not build a second client or reconnect chat", async () => {
    const svc = new TwitchChatClientService({
      channel: "c",
      credentials: { clientId: "c", clientSecret: "s", redirectUri: "http://localhost" },
      requestToken: noDashboard,
      getSetting: async () => undefined,
      sentLines: sentLines(),
    });

    await svc.connect();
    await svc.connect();

    expect(initMock).toHaveBeenCalledTimes(1);
    expect(chatConnectMock).toHaveBeenCalledTimes(1);
  });

  test("disconnect tears down chat and clears connected/health state", async () => {
    const svc = new TwitchChatClientService({
      channel: "c",
      credentials: { clientId: "c", clientSecret: "s", redirectUri: "http://localhost" },
      requestToken: noDashboard,
      getSetting: async () => undefined,
      sentLines: sentLines(),
    });
    await svc.connect();

    await svc.disconnect();

    expect(chatQuitMock).toHaveBeenCalledTimes(1);
    expect(svc.connected).toBe(false);
    expect(svc.healthcheck).toBe(false);
  });

  test("disconnect when already disconnected is a safe no-op", async () => {
    const svc = new TwitchChatClientService({
      channel: "c",
      credentials: { clientId: "c", clientSecret: "s", redirectUri: "http://localhost" },
      requestToken: noDashboard,
      getSetting: async () => undefined,
      sentLines: sentLines(),
    });

    await svc.disconnect();

    expect(chatQuitMock).not.toHaveBeenCalled();
  });

  test("disconnect after connect is idempotent: quit is not called twice", async () => {
    const svc = new TwitchChatClientService({
      channel: "c",
      credentials: { clientId: "c", clientSecret: "s", redirectUri: "http://localhost" },
      requestToken: noDashboard,
      getSetting: async () => undefined,
      sentLines: sentLines(),
    });
    await svc.connect();
    await svc.disconnect();
    chatQuitMock.mockClear();

    await svc.disconnect();

    expect(chatQuitMock).not.toHaveBeenCalled();
  });
});

describe("TwitchChatClientService before and after Twitch is linked", () => {
  const config = {
    credentials: { clientId: "c", clientSecret: "s", redirectUri: "http://localhost" },
    requestToken: noDashboard,
    getSetting: async () => undefined,
    sentLines: sentLines(),
  };

  function notLinked(): Error {
    const err = new Error("Missing broadcaster token in db proxy setting: twitch_token");
    err.name = "TwitchNotLinked";
    return err;
  }

  beforeEach(() => {
    initMock.mockClear();
    chatConnectMock.mockClear();
  });

  test("waits, healthy but not connected, while no account is linked", async () => {
    initMock.mockImplementationOnce(async () => {
      throw notLinked();
    });
    const svc = new TwitchChatClientService(config);

    await svc.connect();

    expect(svc.waitingForLink).toBe(true);
    expect(svc.healthcheck).toBe(true);
    expect(svc.connected).toBe(false);
    expect(svc.channel()).toBeNull();
    await expect(svc.say("hello")).rejects.toThrow("not connected");
  });

  test("connects on reload once the account is linked, joining the linked channel", async () => {
    initMock.mockImplementationOnce(async () => {
      throw notLinked();
    });
    const svc = new TwitchChatClientService(config);
    await svc.connect();

    await svc.reload();

    expect(svc.waitingForLink).toBe(false);
    expect(svc.connected).toBe(true);
    expect(svc.channel()).toBe("linked-login");
    expect(chatConnectMock).toHaveBeenCalledTimes(1);
  });

  test("still fails on anything other than a missing link", async () => {
    initMock.mockImplementationOnce(async () => {
      throw new Error("Twitch is down");
    });
    const svc = new TwitchChatClientService(config);

    await expect(svc.connect()).rejects.toThrow("Twitch is down");
    expect(svc.healthcheck).toBe(false);
  });
});

describe("TwitchChatClientService and its own lines", () => {
  async function connected() {
    const svc = new TwitchChatClientService({
      channel: "chan",
      credentials: { clientId: "c", clientSecret: "s", redirectUri: "http://localhost" },
      requestToken: noDashboard,
      getSetting: async () => undefined,
      sentLines: sentLines(),
    });
    await svc.connect();
    return svc;
  }

  beforeEach(() => {
    initMock.mockClear();
    chatSayMock.mockClear();
  });

  test("a reply that would run a command is said with a zero-width space first", async () => {
    const svc = await connected();

    await svc.say("!title pwned");
    await svc.say("plain words");

    expect(chatSayMock.mock.calls.map((call) => call[1])).toEqual(["​!title pwned", "plain words"]);
  });

  test("recognises the echo of a line it said, once, from the account it speaks as", async () => {
    const svc = await connected();
    await svc.say("!title pwned");

    expect(svc.consumeOwnEcho("someone-else", "!title pwned")).toBe(false);
    expect(svc.consumeOwnEcho(SPEAKER_ID, "!title pwned")).toBe(true);
    expect(svc.consumeOwnEcho(SPEAKER_ID, "!title pwned")).toBe(false);
  });

  test("a line from the bot's account it never said is not an echo", async () => {
    const svc = await connected();
    await svc.say("hello");

    expect(svc.consumeOwnEcho(SPEAKER_ID, "!title mine")).toBe(false);
  });

  test("nothing is an echo while chat is not connected", async () => {
    const svc = await connected();
    await svc.say("hello");
    await svc.disconnect();

    expect(svc.consumeOwnEcho(SPEAKER_ID, "hello")).toBe(false);
  });
});
