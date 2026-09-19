import { beforeEach, describe, expect, mock, test } from "bun:test";

const initMock = mock(async () => {});
const chatConnectMock = mock(() => {});
const chatQuitMock = mock(() => {});

let lastConstructedArgs: unknown;

mock.module("@woofx3/twitch", () => ({
  __esModule: true,
  default: class TwitchClientMock {
    constructor(args: unknown) {
      lastConstructedArgs = args;
    }
    init = initMock;
    ChatClient() {
      return { connect: chatConnectMock, quit: chatQuitMock };
    }
    broadcaster = async () => ({ id: "42", name: "linked-login" });
  },
}));

const { default: TwitchChatClientService } = await import("./twitchChat");

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
      getSetting: async () => undefined,
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
      getSetting,
    });

    await svc.connect();

    expect(lastConstructedArgs).toEqual({
      channel: "mychannel",
      getSetting,
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
      getSetting: async () => undefined,
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
      getSetting: async () => undefined,
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
      getSetting: async () => undefined,
    });

    await svc.disconnect();

    expect(chatQuitMock).not.toHaveBeenCalled();
  });

  test("disconnect after connect is idempotent: quit is not called twice", async () => {
    const svc = new TwitchChatClientService({
      channel: "c",
      credentials: { clientId: "c", clientSecret: "s", redirectUri: "http://localhost" },
      getSetting: async () => undefined,
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
    getSetting: async () => undefined,
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
