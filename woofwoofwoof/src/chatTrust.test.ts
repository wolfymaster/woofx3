import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { EventType as ChatEventType } from "@woofx3/common/cloudevents/Chat";
import { EventType as CommandEventType } from "@woofx3/common/cloudevents/Command";
import { EventType } from "@woofx3/common/cloudevents/Twitch";
import type { Command } from "@woofx3/db/command.pb";
import { dbProxyClientConfig } from "@woofx3/db/service-auth";

/** The linked broadcaster, whose token the bot speaks with. */
const BROADCASTER_ID = "b-1";

const chatSay = mock(async (_channel: string, _text: string, _opts?: unknown) => {});

mock.module("@woofx3/twitch", () => ({
  __esModule: true,
  default: class TwitchClientMock {
    init = async () => ({ getAccessTokenForIntent: async (_intent: string) => ({ userId: BROADCASTER_ID }) });
    ChatClient() {
      return { connect: () => {}, quit: () => {}, say: chatSay };
    }
    broadcaster = async () => ({ id: BROADCASTER_ID, name: "streamer" });
  },
}));

const { default: WoofWoofWoof } = await import("./application");
const { default: TwitchChatClientService } = await import("./services/twitchChat");
const { DatabaseClient } = await import("./services/database");
const { DEFAULT_SENT_LINE_CONFIG, SentLineRegistry } = await import("./sentLines");

type App = InstanceType<typeof WoofWoofWoof>;
type InitCtx = Parameters<App["init"]>[0];
type Handler = (msg: { json: () => unknown }) => Promise<void>;

const BROADCASTER = { isBroadcaster: true, isModerator: false, isSubscriber: false, isVip: false };
const MODERATOR = { ...BROADCASTER, isBroadcaster: false, isModerator: true };

function storedCommand(overrides: Partial<Command> = {}): Command {
  return {
    id: "c-1",
    command: "hug",
    actionsJson: JSON.stringify([{ id: "a", action: "chat.reply", parameters: { message: "hugs" } }]),
    cooldown: 0,
    priority: 0,
    enabled: true,
    createdAt: { seconds: 0n, nanos: 0 },
    createdByType: "",
    createdByRef: "",
    visibility: "public",
    groupIds: [],
    usernames: [],
    argumentPattern: "",
    workflowId: "",
    stepsJson: "[]",
    workflowError: "",
    ...overrides,
  };
}

async function start(options: { commands?: () => Command[] | Promise<Command[]> } = {}) {
  const subscriptions = new Map<string, Handler>();
  const published: { topic: string; data: Uint8Array }[] = [];
  const twitchRequests: string[] = [];
  const messageBus = {
    client: {
      subscribe: (eventType: string, handler: Handler) => {
        subscriptions.set(eventType, handler);
      },
      publish: async (topic: string, data: Uint8Array) => {
        published.push({ topic, data });
      },
      request: async (topic: string, _data: Uint8Array) => {
        twitchRequests.push(topic);
        const reply = { type: "twitchapi.updateStream.result", data: { ok: true } };
        return { data: new TextEncoder().encode(JSON.stringify(reply)) };
      },
    },
  };

  // The real client, so its lookup by id runs against a fake listing.
  const commands = options.commands ?? (() => []);
  const db = Object.assign(
    new DatabaseClient(dbProxyClientConfig("http://db-proxy.invalid", "chat-trust-db-proxy-token")),
    {
      listCommands: mock(async () => ({ status: { code: "OK" as const, message: "" }, commands: await commands() })),
      hasPermission: mock(async () => ({ code: "PERMISSION_DENIED" as const, message: "" })),
      listGroups: mock(async () => ({
        status: { code: "OK" as const, message: "" },
        groups: [{ id: "g-mod", name: "moderator", description: "", isBuiltIn: true }],
      })),
      addUserToGroup: mock(async () => ({ code: "OK" as const, message: "" })),
      removeUserFromGroup: mock(async () => ({ code: "OK" as const, message: "" })),
    }
  );

  const twitchChat = new TwitchChatClientService({
    requestToken: async () => {
      throw new Error("no dashboard in this test");
    },
    getSetting: async () => undefined,
    sentLines: new SentLineRegistry(DEFAULT_SENT_LINE_CONFIG, () => 0),
  });
  await twitchChat.connect();

  const logger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
  const app = new WoofWoofWoof();
  const ctx = {
    ...app.context,
    config: { getConfig: () => "" },
    logger,
    services: { barkloader: { client: { registerHandler: () => {} } }, db: { client: db }, messageBus, twitchChat },
  } as unknown as InitCtx;
  await app.init(ctx);
  await app.run(ctx);

  const deliver = async (eventType: string, envelope: Record<string, unknown>) => {
    const handler = subscriptions.get(eventType);
    if (!handler) {
      throw new Error(`no subscription for ${eventType}`);
    }
    await handler({ json: () => envelope });
  };
  const chat = (source: string, data: Record<string, unknown>) => deliver(EventType.ChatMessage, { source, data });
  return { db, chat, deliver, published, twitchChat, twitchRequests };
}

function topics(published: { topic: string }[]): string[] {
  return published.map((p) => p.topic);
}

function dispatchedActions(published: { topic: string; data: Uint8Array }[]): { action: string }[] {
  const dispatch = published.find((p) => p.topic === "action.execute");
  if (!dispatch) {
    throw new Error("expected an action.execute publish");
  }
  return JSON.parse(new TextDecoder().decode(dispatch.data)).data.actions;
}

describe("woofwoofwoof's chat trust boundary", () => {
  const origLog = console.log;
  beforeAll(() => {
    console.log = () => {};
  });
  afterAll(() => {
    console.log = origLog;
  });

  beforeEach(() => {
    chatSay.mockClear();
  });

  // Twitch may or may not keep the zero-width space in front of the echo; the
  // stripped form is the one the commander would otherwise match.
  test("the bot's own line coming back as the broadcaster's runs no command", async () => {
    const { chat, twitchChat, twitchRequests } = await start();
    await twitchChat.say("!title pwned");

    await chat("twitch", {
      message: "!title pwned",
      chatterName: "streamer",
      chatterId: BROADCASTER_ID,
      membership: BROADCASTER,
    });

    expect(twitchRequests).toEqual([]);
  });

  test("the streamer typing a command from the broadcaster account still runs it", async () => {
    const { chat, twitchChat, twitchRequests } = await start();
    await twitchChat.say("!title pwned");

    await chat("twitch", {
      message: "!title Building a bot",
      chatterName: "streamer",
      chatterId: BROADCASTER_ID,
      membership: BROADCASTER,
    });

    expect(twitchRequests).toEqual(["twitchapi"]);
  });

  test("a line sent to chat that would run a command is said with a zero-width space first", async () => {
    const { deliver } = await start();

    await deliver(ChatEventType.SendMessage, {
      source: "workflow",
      data: { message: "!title pwned", platform: "twitch" },
    });

    expect(chatSay.mock.calls.map((call) => call[1])).toEqual(["\u200b!title pwned"]);
  });

  test("a simulated chat message runs commands but writes no group membership", async () => {
    const { chat, db, published } = await start({ commands: () => [storedCommand()] });

    await chat("api", { message: "!hug", chatterName: "faker", chatterId: "v-1", membership: MODERATOR });

    expect(db.addUserToGroup).not.toHaveBeenCalled();
    expect(topics(published)).toContain("chat.command.hug");
  });

  test("a chat message relayed from Twitch writes group membership", async () => {
    const { chat, db } = await start();

    await chat("twitch", { message: "hello", chatterName: "realmod", chatterId: "v-2", membership: MODERATOR });

    expect(db.addUserToGroup).toHaveBeenCalledWith({ groupId: "g-mod", username: "realmod" });
  });

  test("a command.created event applies the stored command, not the snapshot it carries", async () => {
    let stored: Command[] = [];
    const { chat, deliver, published } = await start({ commands: () => stored });
    stored = [storedCommand()];

    await deliver(CommandEventType.Created, {
      source: "anything",
      data: {
        command: {
          id: "c-1",
          command: "hug",
          actions: [{ id: "x", action: "function", function: "steal_secrets" }],
          workflowId: "",
          cooldown: 0,
          priority: 0,
          enabled: true,
          visibility: "public",
          groupIds: [],
          usernames: [],
          argumentPattern: "",
        },
      },
    });
    await chat("twitch", { message: "!hug", chatterName: "viewer", chatterId: "v-1" });

    expect(dispatchedActions(published).map((a) => a.action)).toEqual(["chat.reply"]);
  });

  test("a command event for a command db-proxy does not hold registers nothing", async () => {
    const { chat, deliver, published } = await start();

    await deliver(CommandEventType.Created, {
      source: "anything",
      data: { command: { id: "forged", command: "evil", actions: [], enabled: true, visibility: "public" } },
    });
    await chat("twitch", { message: "!evil", chatterName: "viewer", chatterId: "v-1" });

    expect(topics(published)).toEqual([]);
  });

  test("a command.deleted event removes a command only once db-proxy no longer holds it", async () => {
    let stored = [storedCommand()];
    const { chat, deliver, published } = await start({ commands: () => stored });

    await deliver(CommandEventType.Deleted, { source: "anything", data: { id: "c-1" } });
    await chat("twitch", { message: "!hug", chatterName: "viewer", chatterId: "v-1" });
    expect(topics(published)).toContain("chat.command.hug");

    published.length = 0;
    stored = [];
    await deliver(CommandEventType.Deleted, { source: "anything", data: { id: "c-1" } });
    await chat("twitch", { message: "!hug", chatterName: "viewer", chatterId: "v-1" });
    expect(topics(published)).toEqual([]);
  });

  test("a command.updated event follows a rename in db-proxy", async () => {
    let stored = [storedCommand()];
    const { chat, deliver, published } = await start({ commands: () => stored });
    stored = [storedCommand({ command: "cuddle" })];

    await deliver(CommandEventType.Updated, { source: "anything", data: { command: { id: "c-1" } } });
    await chat("twitch", { message: "!hug", chatterName: "viewer", chatterId: "v-1" });
    await chat("twitch", { message: "!cuddle", chatterName: "viewer", chatterId: "v-1" });

    expect(topics(published).filter((t) => t.startsWith("chat.command."))).toEqual(["chat.command.cuddle"]);
  });

  test("two events for one command apply db-proxy's answers in the order the events arrived", async () => {
    let stored = [storedCommand()];
    let releaseFirst = () => {};
    let firstLookupStarted = () => {};
    const firstLookup = new Promise<void>((resolve) => {
      firstLookupStarted = resolve;
    });
    let lookups = 0;
    const { chat, deliver, published } = await start({
      commands: () => {
        lookups++;
        const answer = stored;
        // Lookup 1 is the startup load; lookup 2, the first reload's, answers
        // only after the second event has had its chance to reload.
        if (lookups !== 2) {
          return answer;
        }
        firstLookupStarted();
        return new Promise<Command[]>((resolve) => {
          releaseFirst = () => resolve(answer);
        });
      },
    });

    stored = [storedCommand({ command: "cuddle" })];
    const first = deliver(CommandEventType.Updated, { source: "anything", data: { command: { id: "c-1" } } });
    await firstLookup;
    stored = [storedCommand({ command: "snuggle" })];
    const second = deliver(CommandEventType.Updated, { source: "anything", data: { command: { id: "c-1" } } });
    await Bun.sleep(0);
    releaseFirst();
    await Promise.all([first, second]);

    await chat("twitch", { message: "!cuddle", chatterName: "viewer", chatterId: "v-1" });
    await chat("twitch", { message: "!snuggle", chatterName: "viewer", chatterId: "v-1" });
    expect(topics(published).filter((t) => t.startsWith("chat.command."))).toEqual(["chat.command.snuggle"]);
  });
});
