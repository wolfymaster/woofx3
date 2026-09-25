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

// Return type inferred from the cast below, deliberately: annotating it
// `InitCtx` widens away the spies the tests then assert on, which is why every
// `base.chatSay` / `base.publishLog` read was a type error.
function buildTestContext(options: {
  listCommands?: () => Promise<{ status: { code: string; message?: string }; commands: Command[] }>;
}) {
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
  const barkInvoke = mock(async (_func: string, _event: Record<string, unknown>): Promise<unknown> => "");

  const barkloader = {
    client: {
      registerHandler: (name: string, fn: (msg: unknown) => void) => {
        barkHandlers[name] = fn;
      },
      send: barkSend,
      invoke: barkInvoke,
    },
  };

  const listCommandsFn =
    options.listCommands ??
    (async () => ({
      status: { code: "OK", message: "" },
      commands: [] as Command[],
    }));

  const registerTriggers = mock(async (_req: unknown) => ({ status: { code: "OK" }, triggers: [] }));

  const db = {
    client: {
      hasPermission: mock(async () => ({ code: "OK" as const })),
      listCommands: mock(listCommandsFn),
      addUserToResource: mock(async () => ({ code: "OK" as const })),
      removeUserFromResource: mock(async () => ({ code: "OK" as const })),
      registerTriggers,
    },
  };

  const twitchChat = {
    channel: () => "testchannel",
    say: (text: string, opts?: unknown) => say("testchannel", text, opts),
  };

  const services = {
    barkloader,
    db,
    messageBus,
    twitchChat,
  } as unknown as WoofWoofWoofServices;

  const config = {
    getConfig: (key: string) => {
      const m: Record<string, string> = {
        woofx3TwitchChannelName: "testchannel",
      };
      return m[key] ?? "";
    },
  };

  const loggerWarn = mock((..._args: unknown[]) => {});
  const logger = {
    info: () => {},
    error: () => {},
    warn: loggerWarn,
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
    barkInvoke,
    registerTriggers,
    chatSay: say,
    loggerWarn,
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
    const ctx = { ...app.context, ...base } as InitCtx & typeof base;
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
    const ctx = { ...app.context, ...base } as InitCtx & typeof base;
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

  test("a command's actions are dispatched to the engine, carrying the command event", async () => {
    const songCmd = {
      id: "c1",
      command: "customsong",
      actionsJson: JSON.stringify([
        { id: "action-1", action: "function", function: "song_request" },
        { id: "action-2", action: "chat.reply", parameters: { message: "queued ${trigger.data.variables.songTitle}" } },
      ]),
      cooldown: 0,
      priority: 0,
      enabled: true,
      createdBy: "",
      createdAt: {} as never,
      createdByType: "",
      createdByRef: "",
      argumentPattern: "{songTitle}",
    } as unknown as Command;

    const app = new WoofWoofWoof();
    const base = buildTestContext({
      listCommands: async () => ({ status: { code: "OK", message: "" }, commands: [songCmd] }),
    });
    const ctx = { ...app.context, ...base } as InitCtx & typeof base;
    await app.init(ctx);
    await app.run(ctx);

    const handler = getChatHandler(base);
    await handler({
      json: () => ({ data: { message: "!customsong Life is a highway", chatterName: "user1" } }),
    });

    const dispatch = base.publishLog.find((p) => p.topic === "action.execute");
    expect(dispatch).toBeDefined();
    if (!dispatch) {
      throw new Error("expected an action.execute publish");
    }
    const payload = JSON.parse(new TextDecoder().decode(dispatch.data)) as {
      data: {
        label: string;
        actions: { action: string; function?: string }[];
        event: { type: string; data: Record<string, unknown> };
      };
    };
    expect(payload.data.label).toBe("command:customsong");
    expect(payload.data.actions.map((a) => a.action)).toEqual(["function", "chat.reply"]);
    expect(payload.data.actions[0]?.function).toBe("song_request");
    // The actions resolve against the same payload a workflow triggered by
    // this command sees, argument_pattern captures included.
    expect(payload.data.event.type).toBe("chat.command.customsong");
    expect(payload.data.event.data).toEqual({
      command: "customsong",
      rawMessage: "!customsong Life is a highway",
      text: "Life is a highway",
      args: ["Life", "is", "a", "highway"],
      variables: { songTitle: "Life is a highway" },
      chatter: "user1",
      platform: "twitch",
    });
    // Nothing is said from here: a reply is the chat.reply action's job.
    expect(base.chatSay).not.toHaveBeenCalled();
  });

  test("a command with no actions announces itself and runs nothing", async () => {
    const triggerOnly = {
      id: "c2",
      command: "raid",
      actionsJson: "[]",
      cooldown: 0,
      priority: 0,
      enabled: true,
      createdBy: "",
      createdAt: {} as never,
      createdByType: "",
      createdByRef: "",
    } as unknown as Command;

    const app = new WoofWoofWoof();
    const base = buildTestContext({
      listCommands: async () => ({ status: { code: "OK", message: "" }, commands: [triggerOnly] }),
    });
    const ctx = { ...app.context, ...base } as InitCtx & typeof base;
    await app.init(ctx);
    await app.run(ctx);

    const handler = getChatHandler(base);
    await handler({ json: () => ({ data: { message: "!raid", chatterName: "user1" } }) });

    expect(base.publishLog.find((p) => p.topic === "action.execute")).toBeUndefined();
    expect(base.publishLog.find((p) => p.topic === "chat.command.raid")).toBeDefined();
    expect(base.chatSay).not.toHaveBeenCalled();
  });

  test("a command whose actions are unreadable runs nothing rather than breaking the command", async () => {
    const brokenCmd = {
      id: "c3",
      command: "broken",
      actionsJson: "{not json",
      cooldown: 0,
      priority: 0,
      enabled: true,
      createdBy: "",
      createdAt: {} as never,
      createdByType: "",
      createdByRef: "",
    } as unknown as Command;

    const app = new WoofWoofWoof();
    const base = buildTestContext({
      listCommands: async () => ({ status: { code: "OK", message: "" }, commands: [brokenCmd] }),
    });
    const ctx = { ...app.context, ...base } as InitCtx & typeof base;
    await app.init(ctx);
    await app.run(ctx);

    const handler = getChatHandler(base);
    await handler({ json: () => ({ data: { message: "!broken", chatterName: "user1" } }) });

    expect(base.publishLog.find((p) => p.topic === "action.execute")).toBeUndefined();
    expect(base.publishLog.find((p) => p.topic === "chat.command.broken")).toBeDefined();
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

  // The chat-command trigger is declared by the bundled `woofx3` module and
  // installed by barkloader, not registered from here. woofwoofwoof still
  // owns the commander and command CRUD -- only the declaration moved, and
  // a service that writes catalog rows on startup is what this replaces.
  test("registers no workflow triggers on init", async () => {
    const app = new WoofWoofWoof();
    const base = buildTestContext({});
    const ctx = { ...app.context, ...base } as InitCtx & typeof base;
    await app.init(ctx);

    expect(base.registerTriggers).not.toHaveBeenCalled();
  });
});
