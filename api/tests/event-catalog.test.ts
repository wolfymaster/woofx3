import { describe, expect, mock, test } from "bun:test";
import type { SharedLogger } from "@woofx3/common/logging";
import type { Trigger } from "@woofx3/db/module_trigger.pb";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import { buildEventCatalog, EventCatalog, isDefaultTaxonomy } from "../src/event-catalog";

const logger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as SharedLogger;

function trigger(event: string, overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: `t-${event}`,
    name: event,
    description: "",
    event,
    configSchema: "[]",
    allowVariants: false,
    createdByType: "MODULE",
    createdByRef: "woofx3_twitch",
    manifestId: event,
    taxonomy: [],
    emits: "{}",
    transport: "eventbus",
    handler: "",
    sentence: "",
    ...overrides,
  };
}

function emits(...fields: Record<string, unknown>[]): string {
  return JSON.stringify({ fields });
}

describe("buildEventCatalog", () => {
  test("keeps every eventbus subject and leaves out webhook, chat, shared and wildcard ones", () => {
    const catalog = buildEventCatalog([
      trigger("channel.follow"),
      trigger("channel.ad_break.begin"),
      trigger("goal.reached", { createdByRef: "woofx3" }),
      trigger("user.message"),
      trigger("channel.sharedRaid"),
      trigger("chat.command.*", { createdByRef: "woofx3" }),
      trigger("db.workflow.created.*", { createdByRef: "woofx3" }),
      trigger("webhook.woofx3_kofi.kofi", { transport: "webhook", createdByRef: "woofx3_kofi" }),
      trigger("legacy.event", { transport: "" }),
    ]);

    expect([...catalog.keys()]).toEqual(["channel.ad_break.begin", "channel.follow", "goal.reached", "legacy.event"]);
    expect(catalog.get("goal.reached")?.moduleId).toBe("woofx3");
  });

  test("reads the one string viewer identity from emits", () => {
    const catalog = buildEventCatalog([
      trigger("channel.cheer", {
        emits: emits(
          { path: "userId", type: "string", identity: "viewer", anonymousWhen: "isAnonymous", displayName: "userName" },
          { path: "isAnonymous", type: "boolean" },
          { path: "userName", type: "string" }
        ),
      }),
      trigger("chatters.seen", { emits: emits({ path: "ids", type: "array", identity: "viewer" }) }),
      trigger("two.viewers", {
        emits: emits(
          { path: "from", type: "string", identity: "viewer" },
          { path: "to", type: "string", identity: "viewer" }
        ),
      }),
    ]);

    expect(catalog.get("channel.cheer")?.identity).toEqual({
      path: "userId",
      anonymousWhen: "isAnonymous",
      displayName: "userName",
    });
    expect(catalog.get("chatters.seen")?.identity).toBeUndefined();
    expect(catalog.get("two.viewers")?.identity).toBeUndefined();
  });

  test("triggers of one subject that disagree on the viewer attribute it to nobody", () => {
    const catalog = buildEventCatalog([
      trigger("shared.event", { createdByRef: "b", emits: emits({ path: "a", type: "string", identity: "viewer" }) }),
      trigger("shared.event", { createdByRef: "a", emits: emits({ path: "b", type: "string", identity: "viewer" }) }),
    ]);

    expect(catalog.get("shared.event")).toEqual({ subject: "shared.event", moduleId: "a", onByDefault: false });
  });

  test("leaves out every channel.shared event, including ones the Twitch event list does not name", () => {
    const catalog = buildEventCatalog([trigger("channel.sharedSomethingNew"), trigger("channel.share")]);

    expect([...catalog.keys()]).toEqual(["channel.share"]);
  });

  test("an event is on by default when any of its triggers has an alert taxonomy other than chat or shared", () => {
    const catalog = buildEventCatalog([
      trigger("channel.follow", { taxonomy: ["alert.follow"] }),
      trigger("channel.cheer", { taxonomy: ["bits", "alert.cheer.bits"] }),
      trigger("chat.highlighted", { taxonomy: ["alert.chat"] }),
      trigger("chat.first", { taxonomy: ["alert.chat.first"] }),
      trigger("raid.shared", { taxonomy: ["alert.shared.raid"] }),
      trigger("alert.chatter", { taxonomy: ["alert.chatter"] }),
      trigger("wheel.landed", { taxonomy: ["wheel"] }),
      trigger("bare.alert", { taxonomy: ["alert"] }),
      trigger("two.declarations", { createdByRef: "a" }),
      trigger("two.declarations", { createdByRef: "b", taxonomy: ["alert.custom"] }),
    ]);

    const onByDefault = [...catalog.values()].filter((event) => event.onByDefault).map((event) => event.subject);
    expect(onByDefault).toEqual(["alert.chatter", "channel.cheer", "channel.follow", "two.declarations"]);
  });
});

describe("isDefaultTaxonomy", () => {
  test("takes alert entries except alert.chat and alert.shared and what is under them", () => {
    expect(isDefaultTaxonomy("alert.follow")).toBe(true);
    expect(isDefaultTaxonomy("alert.chatter")).toBe(true);
    expect(isDefaultTaxonomy("alert.sharedRaid")).toBe(true);
    expect(isDefaultTaxonomy("alert")).toBe(false);
    expect(isDefaultTaxonomy("alerts.follow")).toBe(false);
    expect(isDefaultTaxonomy("alert.chat")).toBe(false);
    expect(isDefaultTaxonomy("alert.chat.first")).toBe(false);
    expect(isDefaultTaxonomy("alert.shared")).toBe(false);
    expect(isDefaultTaxonomy("alert.shared.raid")).toBe(false);
  });
});

function fakeBus() {
  const handlers = new Map<string, (msg: Msg) => void>();
  const nats = {
    async subscribe(subject: string, handler: (msg: Msg) => void) {
      handlers.set(subject, handler);
      return { unsubscribe() {} };
    },
  } as unknown as NATSClient;
  return { nats, handlers };
}

describe("EventCatalog", () => {
  test("re-reads the triggers on a trigger change and tells its listeners", async () => {
    let triggers: Trigger[] = [];
    const db = { listTriggers: mock(async () => triggers) };
    const { nats, handlers } = fakeBus();
    const catalog = new EventCatalog(nats, db, logger, { settleMs: 1 });
    const seen: string[][] = [];
    catalog.onChange((events) => {
      seen.push([...events.keys()]);
    });

    await catalog.start();
    expect(catalog.events.size).toBe(0);
    expect(seen).toEqual([]);

    triggers = [trigger("channel.follow")];
    handlers.get("db.module.trigger.>")?.({} as Msg);
    handlers.get("db.module.trigger.>")?.({} as Msg);
    await Bun.sleep(20);
    catalog.stop();

    expect(seen).toEqual([["channel.follow"]]);
    // The burst of two changes cost one read after the first.
    expect(db.listTriggers).toHaveBeenCalledTimes(2);
  });

  test("retries a failed read until the db answers", async () => {
    let calls = 0;
    const db = {
      listTriggers: mock(async () => {
        calls++;
        if (calls < 3) {
          throw new Error("db-proxy down");
        }
        return [trigger("channel.follow")];
      }),
    };
    const catalog = new EventCatalog(fakeBus().nats, db, logger, { minBackoffMs: 1, maxBackoffMs: 2 });

    await catalog.start();
    await Bun.sleep(30);
    catalog.stop();

    expect(calls).toBe(3);
    expect([...catalog.events.keys()]).toEqual(["channel.follow"]);
  });

  test("reads asked for during a read fold into one more", async () => {
    let release: () => void = () => {};
    const db = {
      listTriggers: mock(
        () =>
          new Promise<Trigger[]>((resolve) => {
            release = () => resolve([]);
          })
      ),
    };
    const catalog = new EventCatalog(fakeBus().nats, db, logger);

    const first = catalog.reload();
    const second = catalog.reload();
    const third = catalog.reload();
    release();
    await Bun.sleep(1);
    release();
    await Promise.all([first, second, third]);

    expect(db.listTriggers).toHaveBeenCalledTimes(2);
  });
});
