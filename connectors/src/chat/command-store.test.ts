import { beforeEach, describe, expect, test } from "bun:test";
import type { ActionStep } from "@woofx3/common/cloudevents/Action";
import type { ChatCommandEvent } from "@woofx3/common/cloudevents/Chat/commands";
import { FakeTime, flush, RecordingLogger } from "../host/testing";
import { type CommandRunner, CommandStore, storedCommandDefinition } from "./command-store";
import { type CommandDefinition, CommandTable } from "./commands";
import { chatLine, FakeDispatcherDb, storedCommand } from "./testing";

const CONFIG = { reloadDebounceMs: 250, reloadBackstopMs: 300_000 };

const noRunner: CommandRunner = {
  runWorkflow: async () => {},
  runActions: async () => {},
};

describe("CommandStore", () => {
  let db: FakeDispatcherDb;
  let time: FakeTime;
  let table: CommandTable;
  let logger: RecordingLogger;
  let store: CommandStore;

  beforeEach(() => {
    db = new FakeDispatcherDb();
    time = new FakeTime();
    logger = new RecordingLogger();
    table = new CommandTable([], time);
    store = new CommandStore({
      config: CONFIG,
      db,
      table,
      define: (stored) => storedCommandDefinition(stored, noRunner, logger),
      timers: time,
      logger,
    });
  });

  test("start loads the table", async () => {
    db.commands = [storedCommand(), storedCommand({ id: "c-2", command: "wave" })];
    await store.start();
    expect(table.storedNames().sort()).toEqual(["hug", "wave"]);
  });

  test("start throws when the first load fails", async () => {
    db.failListing = true;
    await expect(store.start()).rejects.toThrow("ListCommands");
  });

  test("a burst of events within the debounce costs one listing", async () => {
    await store.start();
    db.commands = [storedCommand()];
    store.requestReload();
    await time.advance(100);
    store.requestReload();
    await time.advance(100);
    store.requestReload();
    expect(db.listings).toBe(1);

    await time.advance(250);
    await store.idle();
    expect(db.listings).toBe(2);
    expect(table.storedNames()).toEqual(["hug"]);
  });

  test("a rename follows db-proxy by id, and the old name stops matching", async () => {
    db.commands = [storedCommand()];
    await store.start();
    db.commands = [storedCommand({ command: "cuddle" })];
    store.requestReload();
    await time.advance(250);
    await store.idle();
    expect(table.storedNames()).toEqual(["cuddle"]);
  });

  test("a command db-proxy no longer lists, or lists as disabled, is removed", async () => {
    db.commands = [storedCommand(), storedCommand({ id: "c-2", command: "wave" })];
    await store.start();
    db.commands = [storedCommand({ id: "c-2", command: "wave" })];
    store.requestReload();
    await time.advance(250);
    await store.idle();
    expect(table.storedNames()).toEqual(["wave"]);
  });

  test("a command renamed to another's old name keeps it", async () => {
    db.commands = [storedCommand({ id: "c-1", command: "hug" }), storedCommand({ id: "c-2", command: "wave" })];
    await store.start();
    db.commands = [storedCommand({ id: "c-2", command: "hug" })];
    store.requestReload();
    await time.advance(250);
    await store.idle();
    expect(table.storedNames()).toEqual(["hug"]);
    expect(table.match("!hug", "twitch")).not.toBeNull();
  });

  test("a failed reload keeps the last good table", async () => {
    db.commands = [storedCommand()];
    await store.start();
    db.failListing = true;
    store.requestReload();
    await time.advance(250);
    await store.idle();
    expect(table.storedNames()).toEqual(["hug"]);
    expect(logger.at("error").map((e) => e.message)).toContain(
      "could not reload chat commands; keeping the last good table"
    );
  });

  test("the backstop reloads with no event", async () => {
    await store.start();
    db.commands = [storedCommand()];
    await time.advance(300_000);
    await store.idle();
    expect(table.storedNames()).toEqual(["hug"]);
  });

  test("reloads run one at a time and apply in order: an older answer never lands after a newer one", async () => {
    db.commands = [storedCommand()];
    await store.start();

    let release = () => {};
    db.listGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    db.commands = [storedCommand({ command: "cuddle" })];
    store.requestReload();
    await time.advance(250);
    expect(db.listings).toBe(2);

    db.commands = [storedCommand({ command: "snuggle" })];
    store.requestReload();
    await time.advance(250);
    // The second reload waits for the first instead of racing it.
    expect(db.listings).toBe(2);

    release();
    await flush();
    await store.idle();
    expect(db.listings).toBe(3);
    expect(table.storedNames()).toEqual(["snuggle"]);
  });

  test("one row that cannot run is skipped; the others load", async () => {
    db.commands = [storedCommand({ id: "c-1", command: "two words" }), storedCommand({ id: "c-2", command: "wave" })];
    await store.start();
    expect(table.storedNames()).toEqual(["wave"]);
    expect(logger.at("error").map((e) => e.message)).toContain("skipped a stored chat command that cannot run");
  });

  test("an unchanged row keeps its definition", async () => {
    db.commands = [storedCommand()];
    await store.start();
    const before = table.match("!hug", "twitch")?.definition;
    store.requestReload();
    await time.advance(250);
    await store.idle();
    expect(table.match("!hug", "twitch")?.definition).toBe(before as CommandDefinition);
  });

  test("stop cancels pending reloads", async () => {
    await store.start();
    store.requestReload();
    await store.stop();
    await time.advance(300_000);
    expect(db.listings).toBe(1);
    expect(time.pending).toBe(0);
  });
});

describe("storedCommandDefinition", () => {
  const event = { id: "evt-1", type: "chat.command.hug" } as ChatCommandEvent;
  const invocation = { line: chatLine(), commandName: "hug", text: "", args: [], variables: {}, event };

  test("a command linked to a workflow runs that workflow with the announced event", async () => {
    const runs: Array<{ workflowId: string; event: ChatCommandEvent }> = [];
    const definition = storedCommandDefinition(
      storedCommand({ workflowId: "wf-1" }),
      { ...noRunner, runWorkflow: async (workflowId, ran) => void runs.push({ workflowId, event: ran }) },
      new RecordingLogger()
    );
    expect(await definition.handler(invocation)).toBe("");
    expect(runs).toEqual([{ workflowId: "wf-1", event }]);
  });

  test("a workflow that could not be started is told to chat, without the error's detail", async () => {
    const definition = storedCommandDefinition(
      storedCommand({ workflowId: "wf-1" }),
      {
        ...noRunner,
        runWorkflow: async () => {
          throw new Error("bus down");
        },
      },
      new RecordingLogger()
    );
    expect(await definition.handler(invocation)).toBe("Could not run !hug right now");
  });

  test("a command's own actions run under its label", async () => {
    const runs: Array<{ label: string; actions: ActionStep[] }> = [];
    const actions = [{ id: "a", action: "chat.reply", parameters: { message: "hugs" } }];
    const definition = storedCommandDefinition(
      storedCommand({ actionsJson: JSON.stringify(actions) }),
      { ...noRunner, runActions: async (label, ran) => void runs.push({ label, actions: ran }) },
      new RecordingLogger()
    );
    await definition.handler(invocation);
    expect(runs).toEqual([{ label: "command:hug", actions }]);
  });

  const unreadableActions = [
    { name: "text that is not JSON", actionsJson: "{not json" },
    { name: "JSON that is not a list", actionsJson: JSON.stringify({ action: "chat.reply" }) },
    { name: "a step with no action type", actionsJson: JSON.stringify([{ id: "a", parameters: {} }]) },
  ];
  for (const { name, actionsJson } of unreadableActions) {
    test(`unreadable actions (${name}) run nothing, are logged, and the command still matches`, async () => {
      const logger = new RecordingLogger();
      let ran = false;
      const definition = storedCommandDefinition(
        storedCommand({ actionsJson }),
        {
          ...noRunner,
          runActions: async () => {
            ran = true;
          },
        },
        logger
      );
      expect(await definition.handler(invocation)).toBe("");
      expect(ran).toBe(false);
      expect(logger.at("error").map((entry) => entry.message)).toEqual([
        "a command's actions are unreadable; none run",
      ]);
    });
  }

  test("visibility, cooldown and argument pattern carry over", () => {
    const definition = storedCommandDefinition(
      storedCommand({ visibility: "restricted", cooldown: 30, argumentPattern: "{songTitle}" }),
      noRunner,
      new RecordingLogger()
    );
    expect(definition.visibility).toBe("restricted");
    expect(definition.cooldownSeconds).toBe(30);
    expect(definition.variables).toEqual(["songTitle"]);
  });
});
