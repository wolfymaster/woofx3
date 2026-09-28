import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { EventType } from "@woofx3/common/cloudevents/Twitch";
import type { Command } from "@woofx3/db/command.pb";
import type { WoofWoofWoofServices } from "./application";
import WoofWoofWoof from "./application";

type InitCtx = Parameters<WoofWoofWoof["init"]>[0];

const VIEWER = { isBroadcaster: false, isModerator: false, isSubscriber: false, isVip: false };
const MODERATOR = { ...VIEWER, isModerator: true };
const BROADCASTER = { ...VIEWER, isBroadcaster: true };

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
type TwitchReply = { type: string; data: unknown };

function buildTestContext(options: {
  listCommands?: () => Promise<{ status: { code: string; message?: string }; commands: Command[] }>;
  /** What the twitch service answers a `twitchapi` request with. */
  twitchReply?: (command: string, args: Record<string, unknown>) => TwitchReply;
  /** The permission model's answer; granted when omitted. */
  hasPermission?: () => Promise<{ code: string }>;
}) {
  const say = mock(async (_channel: string, _message: string, _opts?: unknown) => {});

  const publishLog: { topic: string; data: Uint8Array }[] = [];
  const requestLog: { topic: string; data: Uint8Array }[] = [];
  const subscriptions: { eventType: string; handler: (msg: unknown) => void | Promise<void> }[] = [];
  const messageBus = {
    client: {
      subscribe: (eventType: string, handler: (msg: unknown) => void | Promise<void>) => {
        subscriptions.push({ eventType, handler });
      },
      publish: (topic: string, data: Uint8Array) => {
        publishLog.push({ topic, data });
      },
      request: async (topic: string, data: Uint8Array, _opts?: unknown) => {
        requestLog.push({ topic, data });
        const { command, args } = decodeCommandPayload(data);
        const reply = options.twitchReply?.(command, args) ?? { type: `twitchapi.${command}.result`, data: {} };
        return { subject: "inbox", data: new TextEncoder().encode(JSON.stringify(reply)) };
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
      hasPermission: mock(options.hasPermission ?? (async () => ({ code: "OK" }))),
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
    requestLog,
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

  test("!category asks the twitch service and says which category it chose", async () => {
    const app = new WoofWoofWoof();
    const base = buildTestContext({
      twitchReply: () => ({
        type: "twitchapi.updateStream.result",
        data: { ok: true, categoryId: "1469308723", categoryName: "Software and Game Development" },
      }),
    });
    const ctx = { ...app.context, ...base } as InitCtx & typeof base;
    await app.init(ctx);
    await app.run(ctx);

    await getChatHandler(base)({
      json: () => ({ data: { message: "!category software and game", chatterName: "mod", membership: MODERATOR } }),
    });

    expect(base.requestLog).toHaveLength(1);
    expect(base.requestLog[0]?.topic).toBe("twitchapi");
    const payload = decodeCommandPayload(base.requestLog[0]?.data ?? new Uint8Array());
    expect(payload).toEqual({ command: "updateStream", args: { category: "software and game" } });
    expect(base.chatSay.mock.calls.at(-1)?.[1]).toBe("Stream category set to Software and Game Development");
  });

  test("says in chat why the twitch service refused", async () => {
    const app = new WoofWoofWoof();
    const base = buildTestContext({
      twitchReply: () => ({ type: "twitchapi.error", data: { error: 'no Twitch category matches "zzz"' } }),
    });
    const ctx = { ...app.context, ...base } as InitCtx & typeof base;
    await app.init(ctx);
    await app.run(ctx);

    await getChatHandler(base)({
      json: () => ({ data: { message: "!category zzz", chatterName: "mod", membership: MODERATOR } }),
    });

    expect(base.chatSay.mock.calls.at(-1)?.[1]).toBe('Could not change the category: no Twitch category matches "zzz"');
  });

  test("!title works for the broadcaster and moderators without a grant, and no one else", async () => {
    const app = new WoofWoofWoof();
    const base = buildTestContext({
      hasPermission: async () => ({ code: "PERMISSION_DENIED" }),
      twitchReply: (_command, args) => ({ type: "twitchapi.updateStream.result", data: { ok: true, ...args } }),
    });
    const ctx = { ...app.context, ...base } as InitCtx & typeof base;
    await app.init(ctx);
    await app.run(ctx);
    const handler = getChatHandler(base);

    await handler({
      json: () => ({ data: { message: "!title Hijacked", chatterName: "randomviewer", membership: VIEWER } }),
    });
    expect(base.requestLog).toHaveLength(0);

    for (const [chatterName, membership] of [
      ["streamer", BROADCASTER],
      ["mod", MODERATOR],
    ] as const) {
      await handler({ json: () => ({ data: { message: "!title Building a bot", chatterName, membership } }) });
    }
    expect(base.requestLog).toHaveLength(2);
    const payload = decodeCommandPayload(base.requestLog[1]?.data ?? new Uint8Array());
    expect(payload).toEqual({ command: "updateStream", args: { title: "Building a bot" } });
    expect(base.chatSay.mock.calls.at(-1)?.[1]).toBe("Stream title updated to: Building a bot");
  });

  // A grant through the permission model still lets a trusted viewer in.
  test("!title also works for a chatter the permission model grants", async () => {
    const app = new WoofWoofWoof();
    const base = buildTestContext({});
    const ctx = { ...app.context, ...base } as InitCtx & typeof base;
    await app.init(ctx);
    await app.run(ctx);

    await getChatHandler(base)({
      json: () => ({ data: { message: "!title Granted", chatterName: "editor", membership: VIEWER } }),
    });
    expect(base.requestLog).toHaveLength(1);
  });

  test("!marker places a marker with its description and says where", async () => {
    const app = new WoofWoofWoof();
    const base = buildTestContext({
      twitchReply: () => ({
        type: "twitchapi.createMarker.result",
        data: { id: "m1", createdAt: "", description: "clutch", positionSeconds: 3725 },
      }),
    });
    const ctx = { ...app.context, ...base } as InitCtx & typeof base;
    await app.init(ctx);
    await app.run(ctx);

    await getChatHandler(base)({
      json: () => ({ data: { message: "!marker clutch", chatterName: "mod", membership: MODERATOR } }),
    });

    const payload = decodeCommandPayload(base.requestLog[0]?.data ?? new Uint8Array());
    expect(payload).toEqual({ command: "createMarker", args: { description: "clutch" } });
    expect(base.chatSay.mock.calls.at(-1)?.[1]).toBe("Stream marker placed at 1:02:05");
  });

  test("!vanish times the chatter out", async () => {
    const app = new WoofWoofWoof();
    const base = buildTestContext({});
    const ctx = { ...app.context, ...base } as InitCtx & typeof base;
    await app.init(ctx);
    await app.run(ctx);

    await getChatHandler(base)({
      json: () => ({ data: { message: "!vanish", chatterName: "lurker", membership: VIEWER } }),
    });

    const twitchPublish = base.publishLog.find((p) => p.topic === "twitchapi");
    const payload = decodeCommandPayload(twitchPublish?.data ?? new Uint8Array());
    expect(payload.command).toBe("timeout");
    expect(payload.args.userName).toBe("lurker");
    const duration = payload.args.durationSeconds as number;
    expect(duration >= 1 && duration <= 600).toBe(true);
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
