import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { EventType } from "@woofx3/common/cloudevents/Twitch";
import type { Command } from "@woofx3/db/command.pb";
import type { WoofWoofWoofServices } from "./application";
import WoofWoofWoof from "./application";

type InitCtx = Parameters<WoofWoofWoof["init"]>[0];

function decodeCommandPayload(data: Uint8Array): { command: string; args: Record<string, unknown> } {
  return JSON.parse(new TextDecoder().decode(data)) as { command: string; args: Record<string, unknown> };
}

function getChatHandler(base: {
  subscriptions: { eventType: string; handler: (msg: unknown) => void | Promise<void> }[];
}) {
  const chatSub = base.subscriptions.find((s) => s.eventType === EventType.ChatMessage);
  expect(chatSub).toBeDefined();
  if (!chatSub) {
    throw new Error("expected ChatMessage subscription");
  }
  return chatSub.handler as (msg: { json: () => unknown }) => Promise<void>;
}

function buildTestContext(options: {
  listCommands?: () => Promise<{ status: { code: string; message?: string }; commands: Command[] }>;
}): InitCtx {
  const say = mock(async (_channel: string, _message: string, _opts?: unknown) => {});

  const publishLog: { topic: string; data: Uint8Array }[] = [];
  const subscriptions: { eventType: string; handler: (msg: unknown) => void | Promise<void> }[] = [];
  const messageBus = {
    client: {
      subscribe: (eventType: string, handler: (msg: unknown) => void | Promise<void>) => {
        subscriptions.push({ eventType, handler });
      },
      publish: (topic: string, data: Uint8Array) => {
        publishLog.push({ topic, data });
      },
    },
  };

  const barkHandlers: Record<string, (msg: unknown) => void> = {};
  const barkSend = mock((_payload: string) => {});

  const barkloader = {
    client: {
      registerHandler: (name: string, fn: (msg: unknown) => void) => {
        barkHandlers[name] = fn;
      },
      send: barkSend,
    },
  };

  const listCommandsFn =
    options.listCommands ??
    (async () => ({
      status: { code: "OK", message: "" },
      commands: [] as Command[],
    }));

  const db = {
    client: {
      hasPermission: mock(async () => ({ code: "OK" as const })),
      listCommands: mock(listCommandsFn),
      addUserToResource: mock(async () => ({ code: "OK" as const })),
      removeUserFromResource: mock(async () => ({ code: "OK" as const })),
    },
  };

  const twitchChat = {
    client: { say },
  };

  const services = {
    barkloader,
    db,
    messageBus,
    twitchChat,
  } as WoofWoofWoofServices;

  const config = {
    getConfig: (key: string) => {
      const m: Record<string, string> = {
        woofx3TwitchChannelName: "testchannel",
        spotifyClientId: "",
        spotifyClientSecret: "",
        spotifyAccessToken: "",
        spotifyRefreshToken: "",
      };
      return m[key] ?? "";
    },
  };

  const logger = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  };

  const ctx = {
    config,
    logger,
    services,
    publishLog,
    subscriptions,
    barkHandlers,
    barkSend,
    chatSay: say,
  };

  return ctx as InitCtx & typeof ctx;
}

describe("WoofWoofWoof application", () => {
  const origLog = console.log;
  beforeAll(() => {
    console.log = () => {};
  });
  afterAll(() => {
    console.log = origLog;
  });

  test("run refuses to start before chat command handling is wired up", async () => {
    const app = new WoofWoofWoof();
    const base = buildTestContext({});
    const ctx = { ...app.context, ...base } as InitCtx;
    await expect(app.run(ctx)).rejects.toThrow(/Commander not set/i);
  });

  test("run surfaces database failures when commands cannot be loaded", async () => {
    const app = new WoofWoofWoof();
    const base = buildTestContext({
      listCommands: async () => ({
        status: { code: "ERROR", message: "unavailable" },
        commands: [],
      }),
    });
    const ctx = { ...app.context, ...base } as InitCtx;
    await app.init(ctx);
    await expect(app.run(ctx)).rejects.toThrow(/Failed to load commands/);
  });

  test("chat subscriber relays a matching command reply to the channel", async () => {
    const app = new WoofWoofWoof();
    const base = buildTestContext({});
    const ctx = { ...app.context, ...base } as InitCtx & typeof base;
    await app.init(ctx);
    await app.run(ctx);

    const handler = getChatHandler(base);

    const msg = {
      json: () => ({
        data: {
          message: "!category sgd",
          chatterName: "mod",
        },
      }),
    };
    await handler(msg);

    expect(base.chatSay).toHaveBeenCalled();
    const lastSay = base.chatSay.mock.calls.at(-1);
    expect(lastSay?.[1]).toContain("Software and Game Development");
  });

  test("stream category changes are published for downstream Twitch automation", async () => {
    const app = new WoofWoofWoof();
    const base = buildTestContext({});
    const ctx = { ...app.context, ...base } as InitCtx & typeof base;
    await app.init(ctx);
    await app.run(ctx);

    const handler = getChatHandler(base);

    await handler({
      json: () => ({
        data: { message: "!category jc", chatterName: "mod" },
      }),
    });

    const twitchPublish = base.publishLog.find((p) => p.topic === "twitchapi");
    expect(twitchPublish).toBeDefined();
    if (!twitchPublish) {
      throw new Error("expected twitchapi publish");
    }
    const payload = decodeCommandPayload(twitchPublish.data);
    expect(payload.command).toBe("update_stream");
    expect(payload.args).toEqual({ category: "just chatting" });
  });

  test("only the designated broadcaster can change the stream title", async () => {
    const app = new WoofWoofWoof();
    const base = buildTestContext({});
    const ctx = { ...app.context, ...base } as InitCtx & typeof base;
    await app.init(ctx);
    await app.run(ctx);

    const handler = getChatHandler(base);

    base.publishLog.length = 0;

    await handler({
      json: () => ({
        data: { message: "!title New stream", chatterName: "randomviewer" },
      }),
    });
    expect(base.publishLog.filter((p) => p.topic === "twitchapi")).toHaveLength(0);

    await handler({
      json: () => ({
        data: { message: "!title Allowed", chatterName: "wolfymaster" },
      }),
    });
    const twitchPublish = base.publishLog.find((p) => p.topic === "twitchapi");
    expect(twitchPublish).toBeDefined();
    if (!twitchPublish) {
      throw new Error("expected twitchapi publish");
    }
    const payload = decodeCommandPayload(twitchPublish.data);
    expect(payload.command).toBe("update_stream");
    expect(payload.args).toEqual({ title: "Allowed" });
  });

  test("database-defined function commands delegate execution to Barkloader", async () => {
    const remoteCmd = {
      id: "c1",
      applicationId: "app-1",
      command: "remote",
      type: "function",
      typeValue: "",
      cooldown: 0,
      priority: 0,
      enabled: true,
      createdBy: "",
      createdAt: {} as never,
      createdByType: "",
      createdByRef: "",
    } as Command;

    const app = new WoofWoofWoof();
    const base = buildTestContext({
      listCommands: async () => ({
        status: { code: "OK", message: "" },
        commands: [remoteCmd],
      }),
    });
    const ctx = { ...app.context, ...base } as InitCtx & typeof base;
    await app.init(ctx);
    await app.run(ctx);

    const handler = getChatHandler(base);

    await handler({
      json: () => ({
        data: { message: "!remote hello world", chatterName: "user1" },
      }),
    });

    expect(base.barkSend).toHaveBeenCalled();
    const raw = base.barkSend.mock.calls[0][0] as string;
    const payload = JSON.parse(raw) as { type: string; data: { func: string; args: string[] } };
    expect(payload.type).toBe("invoke");
    expect(payload.data.func).toBe("remote");
    expect(payload.data.args).toEqual(["hello world", "user1"]);
  });

  test("Barkloader forwards outbound chat lines into Twitch when a command is present", async () => {
    const app = new WoofWoofWoof();
    const base = buildTestContext({});
    const ctx = { ...app.context, ...base } as InitCtx & typeof base;
    await app.init(ctx);
    await app.run(ctx);

    const onMessage = base.barkHandlers.onMessage as (msg: {
      error?: string;
      command?: string;
      args: { message: string };
    }) => void;

    onMessage({
      command: "show",
      error: "",
      args: { message: "Hello from module" },
    });

    expect(base.chatSay).toHaveBeenCalled();
    const last = base.chatSay.mock.calls.at(-1);
    expect(last?.[1]).toBe("Hello from module");
  });

  test("Barkloader errors do not attempt to speak in chat", async () => {
    const app = new WoofWoofWoof();
    const base = buildTestContext({});
    const ctx = { ...app.context, ...base } as InitCtx & typeof base;
    await app.init(ctx);
    await app.run(ctx);

    base.chatSay.mockClear();

    const onMessage = base.barkHandlers.onMessage as (msg: {
      error?: string;
      command?: string;
      args: { message: string };
    }) => void;

    onMessage({
      command: "bad",
      error: "failed",
      args: { message: "ignored" },
    });

    expect(base.chatSay).not.toHaveBeenCalled();
  });
});
