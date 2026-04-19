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
      applicationId: "app-1",
      channel: "chan",
      credentials: { clientId: "c", clientSecret: "s", redirectUri: "http://localhost" },
      getSetting: async () => ({ setting: { value: {} } }),
    });

    expect(svc.name).toBe("twitchchat");
    expect(svc.type).toBe("twitchchat");
    expect(svc.connected).toBe(false);
    expect(svc.healthcheck).toBe(false);
  });

  test("connect wires Twitch client with application, channel, and settings resolver, then marks healthy and connected", async () => {
    const getSetting = mock(async () => ({ setting: { value: {} } }));
    const svc = new TwitchChatClientService({
      applicationId: "app-1",
      channel: "mychannel",
      credentials: { clientId: "cid", clientSecret: "sec", redirectUri: "http://r" },
      getSetting,
    });

    await svc.connect();

    expect(lastConstructedArgs).toEqual({
      applicationId: "app-1",
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
      applicationId: "app-1",
      channel: "c",
      credentials: { clientId: "c", clientSecret: "s", redirectUri: "http://localhost" },
      getSetting: async () => ({ setting: { value: {} } }),
    });

    await svc.connect();
    await svc.connect();

    expect(initMock).toHaveBeenCalledTimes(1);
    expect(chatConnectMock).toHaveBeenCalledTimes(1);
  });

  test("disconnect tears down chat and clears connected/health state", async () => {
    const svc = new TwitchChatClientService({
      applicationId: "app-1",
      channel: "c",
      credentials: { clientId: "c", clientSecret: "s", redirectUri: "http://localhost" },
      getSetting: async () => ({ setting: { value: {} } }),
    });
    await svc.connect();

    await svc.disconnect();

    expect(chatQuitMock).toHaveBeenCalledTimes(1);
    expect(svc.connected).toBe(false);
    expect(svc.healthcheck).toBe(false);
  });

  test("disconnect when already disconnected is a safe no-op", async () => {
    const svc = new TwitchChatClientService({
      applicationId: "app-1",
      channel: "c",
      credentials: { clientId: "c", clientSecret: "s", redirectUri: "http://localhost" },
      getSetting: async () => ({ setting: { value: {} } }),
    });

    await svc.disconnect();

    expect(chatQuitMock).not.toHaveBeenCalled();
  });

  test("disconnect after connect is idempotent: quit is not called twice", async () => {
    const svc = new TwitchChatClientService({
      applicationId: "app-1",
      channel: "c",
      credentials: { clientId: "c", clientSecret: "s", redirectUri: "http://localhost" },
      getSetting: async () => ({ setting: { value: {} } }),
    });
    await svc.connect();
    await svc.disconnect();
    chatQuitMock.mockClear();

    await svc.disconnect();

    expect(chatQuitMock).not.toHaveBeenCalled();
  });
});
