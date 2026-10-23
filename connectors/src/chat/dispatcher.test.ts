import { beforeEach, describe, expect, test } from "bun:test";
import { type GatewayReply, type GatewayRequest, PLATFORM_GATEWAY_REPLY_TYPES } from "@woofx3/api/platform-gateway";
import { CHAT_DEFAULTS, type ChatConfig } from "../config/chat";
import { ScopeCounters, ScopedBus } from "../host/scoped-bus";
import { bytes, FakeBus, FakeTime, flush, RecordingLogger, text } from "../host/testing";
import type { CommandDefinition } from "./commands";
import { CHAT_DISPATCHER_GRANTS, CHAT_LINE_SUBJECT, ChatDispatcher, DISPATCHER_EVENT_SOURCE } from "./dispatcher";
import { REPLY_MAX_CHARS } from "./replier";
import { BROADCASTER, FakeDispatcherDb, MODERATOR, NO_ROLES, storedCommand } from "./testing";
import { TRUSTED_LINE_SOURCES } from "./trust";

const CONFIG: ChatConfig = {
  authCache: { capacity: CHAT_DEFAULTS.authCacheCapacity, ttlMs: CHAT_DEFAULTS.authCacheTtlMs },
  groups: { lastSeenCapacity: CHAT_DEFAULTS.groupLastSeenCapacity, catalogTtlMs: CHAT_DEFAULTS.groupCatalogTtlMs },
  store: { reloadDebounceMs: CHAT_DEFAULTS.reloadDebounceMs, reloadBackstopMs: CHAT_DEFAULTS.reloadBackstopMs },
  twitchApi: { timeoutMs: CHAT_DEFAULTS.twitchApiTimeoutMs },
  replyTimeoutMs: 12_000,
};

/** A bus whose platform gateway answers every send as delivered, and records each request. */
class GatewayBus extends FakeBus {
  readonly sends: GatewayRequest[] = [];
  answer: GatewayReply = { ok: true, results: { twitch: { status: "delivered", messageId: "reply-1" } } };

  override async request(subject: string, data: Uint8Array): Promise<{ subject: string; data: Uint8Array }> {
    this.sends.push(JSON.parse(text(data)) as GatewayRequest);
    const envelope = { type: PLATFORM_GATEWAY_REPLY_TYPES.send, source: "connectors", id: "r", data: this.answer };
    return { subject, data: bytes(JSON.stringify(envelope)) };
  }
}

/** A restricted built-in only the broadcaster and moderators run without a grant. */
function titleBuiltin(calls: string[]): CommandDefinition {
  return {
    name: "title",
    visibility: "restricted",
    cooldownSeconds: 0,
    variables: [],
    allowRoles: ["broadcaster", "moderator"],
    handler: async ({ text: title }) => {
      calls.push(title);
      return `Stream title updated to: ${title}`;
    },
  };
}

interface Line {
  source?: string;
  platform?: string;
  messageId?: string;
  chatterId?: string;
  chatterName?: string;
  chatterLogin?: string;
  channelId?: string | null;
  message: string;
  membership?: unknown;
  fromEngine?: boolean;
}

function lineEvent(line: Line): Uint8Array {
  const { source = TRUSTED_LINE_SOURCES.twitch, platform = "twitch", ...data } = line;
  return bytes(
    JSON.stringify({
      specversion: "1.0.0",
      id: `evt-${data.messageId ?? "x"}`,
      type: CHAT_LINE_SUBJECT,
      source,
      platform,
      data: {
        messageId: "m-1",
        chatterId: "v-1",
        chatterName: "Viewer",
        chatterLogin: "viewer",
        channelId: null,
        membership: NO_ROLES,
        fromEngine: false,
        ...data,
      },
    })
  );
}

describe("ChatDispatcher", () => {
  let bus: GatewayBus;
  let db: FakeDispatcherDb;
  let time: FakeTime;
  let logger: RecordingLogger;
  let titles: string[];
  let dispatcher: ChatDispatcher;

  function newScope(): ScopedBus {
    return new ScopedBus({
      scope: "host",
      client: bus,
      grants: CHAT_DISPATCHER_GRANTS,
      limits: { concurrency: 4, queueCap: 16 },
      logger,
      counters: new ScopeCounters(),
      clock: time,
    });
  }

  async function start(builtins: CommandDefinition[] = [titleBuiltin(titles)], scope = newScope()): Promise<void> {
    dispatcher = new ChatDispatcher({ config: CONFIG, db, bus: scope, builtins, clock: time, timers: time, logger });
    await dispatcher.start();
  }

  async function say(line: Line): Promise<void> {
    bus.deliver(CHAT_LINE_SUBJECT, lineEvent(line));
    await flush();
  }

  function published(prefix: string): Array<{ subject: string; event: Record<string, unknown> }> {
    return bus.published
      .filter((p) => p.subject.startsWith(prefix))
      .map((p) => ({ subject: p.subject, event: JSON.parse(text(p.data)) }));
  }

  beforeEach(() => {
    bus = new GatewayBus();
    db = new FakeDispatcherDb();
    time = new FakeTime();
    logger = new RecordingLogger();
    titles = [];
  });

  test("a matched command announces itself, runs, and replies to the line's own platform", async () => {
    await start();
    await say({ message: "!title Building a bot", membership: BROADCASTER, messageId: "m-7" });

    expect(titles).toEqual(["Building a bot"]);
    const [announced] = published("chat.command.");
    expect(announced?.subject).toBe("chat.command.title");
    expect(announced?.event).toMatchObject({
      source: DISPATCHER_EVENT_SOURCE,
      platform: "twitch",
      triggeredBy: "twitch",
      data: { command: "title", text: "Building a bot", chatter: "Viewer", platform: "twitch" },
    });
    expect(bus.sends).toEqual([
      {
        action: "chat.send",
        target: { kind: "origin", origin: { platform: "twitch", messageId: "m-7" } },
        payload: { message: "Stream title updated to: Building a bot" },
        idempotencyKey: "dispatcher:m-7:title",
        requestedBy: { kind: "dispatcher", ref: "chat-dispatcher" },
      },
    ]);
  });

  test("snapshot tallies how each line ended and how many commands are loaded", async () => {
    db.commands = [storedCommand()];
    await start();
    await say({ message: "!title hi", membership: BROADCASTER });
    await say({ message: "just chatting", membership: BROADCASTER });
    await say({ message: "!title x", membership: BROADCASTER, fromEngine: true });
    const snapshot = dispatcher.snapshot();
    expect(snapshot.lines).toMatchObject({ ran: 1, no_command: 1, from_engine: 1, refused: 0 });
    expect(snapshot.commands).toMatchObject({ builtins: 1, storedCommands: 1, reloadFailures: 0 });
  });

  test("a line the engine said itself runs nothing", async () => {
    await start();
    await say({ message: "!title pwned", membership: BROADCASTER, fromEngine: true });
    expect(titles).toEqual([]);
    expect(bus.sends).toEqual([]);
  });

  test("a line with no speaker id is refused", async () => {
    await start();
    await say({ message: "!title pwned", membership: BROADCASTER, chatterId: "" });
    expect(titles).toEqual([]);
    expect(logger.at("warn").map((e) => e.message)).toContain("a chat line was refused");
  });

  test("simulated badges cannot escalate: an untrusted broadcaster is refused a role command", async () => {
    await start();
    await say({ source: "api", message: "!title pwned", membership: BROADCASTER, chatterLogin: "faker" });

    expect(titles).toEqual([]);
    expect(db.permissionChecks).toEqual([{ username: "faker", resource: "command/title" }]);
    expect(bus.sends.map((s) => s.payload)).toEqual([{ message: "Viewer.... YOU CAN'T DO THAT" }]);
  });

  test("an untrusted line runs public commands, writes no groups, and is replied to without threading", async () => {
    const ping: CommandDefinition = {
      ...titleBuiltin(titles),
      name: "ping",
      visibility: "public",
      handler: async () => "pong",
    };
    await start([ping]);
    await say({ source: "api", message: "!ping", membership: MODERATOR, messageId: "made-up" });

    expect(published("chat.command.").map((p) => p.subject)).toEqual(["chat.command.ping"]);
    expect(db.writes).toEqual([]);
    expect(bus.sends.map((s) => [s.target, s.idempotencyKey])).toEqual([
      [{ kind: "origin", origin: { platform: "twitch" } }, "dispatcher:evt-made-up:ping"],
    ]);
  });

  test("a trusted line writes its derived groups before the command's permission check", async () => {
    await start();
    await say({ message: "hello", membership: MODERATOR, chatterLogin: "realmod" });
    expect(db.memberships.has("g-mod realmod")).toBe(true);
  });

  test("a shared-chat line gets no channel roles and writes no groups", async () => {
    await start();
    await say({ message: "!title pwned", membership: MODERATOR, channelId: "partner-1" });
    expect(titles).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  test("the same display name from two accounts is two viewers", async () => {
    db.commands = [storedCommand({ visibility: "restricted" })];
    db.grants.add("wolf command/hug");
    await start();

    await say({ message: "!hug", chatterId: "v-1", chatterName: "Wolf", chatterLogin: "wolf", messageId: "m-1" });
    await say({ message: "!hug", chatterId: "v-2", chatterName: "Wolf", chatterLogin: "wolf_", messageId: "m-2" });

    expect(published("chat.command.")).toHaveLength(1);
    expect(bus.sends.map((s) => s.payload)).toEqual([{ message: "Wolf.... YOU CAN'T DO THAT" }]);
  });

  test("a command in its cooldown is dropped whole: no announcement, no reply", async () => {
    db.commands = [storedCommand({ cooldown: 30, actionsJson: JSON.stringify([{ action: "chat.reply" }]) })];
    await start();
    await say({ message: "!hug", messageId: "m-1" });
    await say({ message: "!hug", messageId: "m-2" });

    expect(published("chat.command.")).toHaveLength(1);
    expect(published("action.execute")).toHaveLength(1);
  });

  test("a stored command linked to a workflow runs it with the announced event", async () => {
    db.commands = [storedCommand({ workflowId: "wf-1" })];
    await start();
    await say({ message: "!hug" });

    const [announced] = published("chat.command.");
    const [run] = published("workflow.command.execute");
    expect(run?.event.data).toMatchObject({ workflowId: "wf-1", event: { id: announced?.event.id } });
  });

  test("a command event reloads the table from db-proxy", async () => {
    await start();
    db.commands = [storedCommand({ command: "wave" })];
    bus.deliver("command.created", bytes(JSON.stringify({ data: { command: { id: "c-1", command: "evil" } } })));
    await flush();
    await time.advance(CHAT_DEFAULTS.reloadDebounceMs);
    await dispatcher.settled();

    await say({ message: "!evil" });
    await say({ message: "!wave" });
    expect(published("chat.command.").map((p) => p.subject)).toEqual(["chat.command.wave"]);
  });

  test("a long reply is cut to what chat takes", async () => {
    await start();
    await say({ message: `!title ${"x".repeat(600)}`, membership: BROADCASTER });
    const message = (bus.sends[0]?.payload as { message: string }).message;
    expect([...message]).toHaveLength(REPLY_MAX_CHARS);
    expect(message.endsWith("…")).toBe(true);
  });

  test("a reply the gateway did not deliver is logged", async () => {
    bus.answer = { ok: false, results: { twitch: { status: "unavailable", reason: "stopped" } } };
    await start();
    await say({ message: "!title x", membership: BROADCASTER });
    expect(logger.at("warn").map((e) => e.message)).toContain("the platform gateway did not deliver a command reply");
  });

  test("a line that names no command, or one for another platform, runs nothing", async () => {
    await start([{ ...titleBuiltin(titles), platforms: [] }]);
    await say({ message: "!title x", membership: BROADCASTER });
    await say({ message: "just chatting", membership: BROADCASTER });
    expect(titles).toEqual([]);
    expect(bus.sends).toEqual([]);
  });

  test("a failing watcher is logged and the line still runs", async () => {
    await start();
    dispatcher.watch(() => {
      throw new Error("watcher broke");
    });
    dispatcher.watch(async () => {
      throw new Error("async watcher broke");
    });
    await say({ message: "!title x", membership: BROADCASTER });
    expect(titles).toEqual(["x"]);
    expect(logger.at("error").filter((e) => e.message === "a chat line watcher failed")).toHaveLength(2);
  });

  test("start throws before subscribing when the first command load fails", async () => {
    db.failListing = true;
    await expect(start()).rejects.toThrow("ListCommands");
    expect(bus.subscriptions).toEqual([]);
  });

  test("a subscribe that fails during start leaves no reload timer running", async () => {
    const scope = newScope();
    await scope.closeAll();
    await expect(start(undefined, scope)).rejects.toThrow("closed");
    expect(time.pending).toBe(0);
  });
});
