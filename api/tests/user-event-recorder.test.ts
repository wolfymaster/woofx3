import { describe, expect, mock, test } from "bun:test";
import { EventType } from "@woofx3/common/cloudevents/Twitch/events";
import type { Msg } from "@woofx3/nats/src/types";
import { DbError } from "../src/db-client";
import type { EventCatalog, LoggedEvent } from "../src/event-catalog";
import { toRequest, UserEventRecorder } from "../src/user-event-recorder";

const SESSION_ID = "7f0c5a1e-0000-4000-8000-000000000001";
const TIME = "2026-09-27T20:00:00.000Z";

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

function envelope(type: string, data: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    specversion: "1.0.0",
    id: "ce-1",
    source: "twitch",
    type,
    time: TIME,
    platform: "twitch",
    sessionId: SESSION_ID,
    data,
    ...overrides,
  };
}

function makeMsg(subject: string, body: unknown): Msg {
  const text = JSON.stringify(body);
  return {
    subject,
    data: new TextEncoder().encode(text),
    json: () => JSON.parse(text),
    string: () => text,
    respond: () => false,
  };
}

/** A Twitch subject as the catalog lists it, with no identity: the fixed map attributes these. */
function twitch(subject: string): LoggedEvent {
  return { subject, moduleId: "woofx3_twitch" };
}

/** A catalog whose set the test changes by hand. */
function fakeCatalog(events: LoggedEvent[]) {
  let listener: ((events: ReadonlyMap<string, LoggedEvent>) => Promise<void> | void) | undefined;
  const catalog = {
    events: new Map(events.map((event) => [event.subject, event])) as ReadonlyMap<string, LoggedEvent>,
    onChange(fn: typeof listener) {
      listener = fn;
    },
  };
  const change = async (next: LoggedEvent[]) => {
    catalog.events = new Map(next.map((event) => [event.subject, event]));
    await listener?.(catalog.events);
  };
  return { catalog: catalog as unknown as EventCatalog, change };
}

function setup(
  recordUserEvent: (req: unknown) => Promise<unknown>,
  events: LoggedEvent[] = [twitch(EventType.Follow)]
) {
  const unsubscribed: string[] = [];
  const nats = {
    subscribe: mock(async (subject: string) => ({
      unsubscribe: () => {
        unsubscribed.push(subject);
      },
    })),
  } as any;
  const db = { recordUserEvent: mock(recordUserEvent) } as any;
  const logger = fakeLogger();
  const sleep = mock(async () => {});
  const { catalog, change } = fakeCatalog(events);
  const recorder = new UserEventRecorder(nats, db, logger, catalog, [10, 20], sleep);
  return { recorder, nats, db, logger, sleep, change, unsubscribed };
}

describe("toRequest", () => {
  test("records a cheer against its viewer, with bits, session and time", () => {
    const data = { amount: 500, isAnonymous: false, message: "hi", userId: "1001", userName: "Viewer" };
    const req = toRequest(twitch(EventType.Cheer), envelope(EventType.Cheer, data));

    expect(req).toEqual({
      eventId: "ce-1",
      source: "twitch",
      eventType: EventType.Cheer,
      platform: "twitch",
      platformUserId: "1001",
      userName: "Viewer",
      sessionId: SESSION_ID,
      amount: 500n,
      eventValue: JSON.stringify(data),
      occurredAt: { seconds: BigInt(Date.parse(TIME) / 1000), nanos: 0 },
    });
  });

  test("an anonymous cheer counts its bits but names nobody", () => {
    const req = toRequest(
      twitch(EventType.Cheer),
      envelope(EventType.Cheer, { amount: 100, isAnonymous: true, message: "", userId: null, userName: null })
    );

    expect(req?.platformUserId).toBeUndefined();
    expect(req?.userName).toBeUndefined();
    expect(req?.amount).toBe(100n);
  });

  test("an anonymous gift is not attributed to the anonymous gifter account", () => {
    const req = toRequest(
      twitch(EventType.SubscriptionGift),
      envelope(EventType.SubscriptionGift, {
        amount: 5,
        gifterId: "274598607",
        gifterName: "AnAnonymousGifter",
        isAnonymous: true,
        tier: "1000",
      })
    );

    expect(req?.platformUserId).toBeUndefined();
    expect(req?.amount).toBe(5n);
  });

  test("a gift is attributed to its gifter", () => {
    const req = toRequest(
      twitch(EventType.SubscriptionGift),
      envelope(EventType.SubscriptionGift, {
        amount: 3,
        gifterId: "1001",
        gifterName: "Gifter",
        isAnonymous: false,
        tier: "1000",
      })
    );

    expect(req?.platformUserId).toBe("1001");
    expect(req?.userName).toBe("Gifter");
    expect(req?.amount).toBe(3n);
  });

  test("a follow is attributed by id", () => {
    const req = toRequest(twitch(EventType.Follow), envelope(EventType.Follow, { userId: "1001", userName: "Viewer" }));

    expect(req?.platformUserId).toBe("1001");
    expect(req?.amount).toBeUndefined();
  });

  test("a raid carries its raider count", () => {
    const req = toRequest(
      twitch(EventType.Raid),
      envelope(EventType.Raid, { fromBroadcasterUserId: "2002", fromBroadcasterUserName: "Raider", viewers: 42 })
    );

    expect(req?.platformUserId).toBe("2002");
    expect(req?.amount).toBe(42n);
  });

  test("a chat-notification sub event is attributed to its chatter unless anonymous", () => {
    const base = { chatterId: "1001", chatterName: "Viewer", tier: "1000", cumulativeMonths: 7 };
    const named = toRequest(twitch(EventType.Resub), envelope(EventType.Resub, { ...base, chatterIsAnonymous: false }));
    const anonymous = toRequest(
      twitch(EventType.Resub),
      envelope(EventType.Resub, { ...base, chatterIsAnonymous: true })
    );

    expect(named?.platformUserId).toBe("1001");
    expect(anonymous?.platformUserId).toBeUndefined();
  });

  test("an unstamped event is still recorded, without a session", () => {
    const req = toRequest(
      twitch(EventType.Follow),
      envelope(EventType.Follow, { userId: "1001", userName: "Viewer" }, { sessionId: undefined })
    );

    expect(req).not.toBeNull();
    expect(req?.sessionId).toBeUndefined();
  });

  test("a dashboard simulation is not a fact", () => {
    const req = toRequest(
      twitch(EventType.Cheer),
      envelope(EventType.Cheer, { amount: 500, isAnonymous: false, userId: "1001" }, { source: "api" })
    );

    expect(req).toBeNull();
  });

  test("an event with no id or no source is not recorded", () => {
    const data = { userId: "1001", userName: "Viewer" };

    expect(toRequest(twitch(EventType.Follow), envelope(EventType.Follow, data, { id: undefined }))).toBeNull();
    expect(toRequest(twitch(EventType.Follow), envelope(EventType.Follow, data, { source: undefined }))).toBeNull();
  });

  test("a module event is attributed through its trigger's identity annotations, with no amount", () => {
    const logged: LoggedEvent = {
      subject: "kofi.donation",
      moduleId: "woofx3_kofi",
      identity: { path: "from.id", displayName: "from.name", anonymousWhen: "isPrivate" },
    };
    const data = { from: { id: "k-1", name: "Supporter" }, isPrivate: false, amount: 5 };
    const req = toRequest(logged, envelope("kofi.donation", data, { platform: undefined, source: "kofi" }));

    expect(req).toEqual({
      eventId: "ce-1",
      source: "kofi",
      eventType: "kofi.donation",
      platform: "woofx3_kofi",
      platformUserId: "k-1",
      userName: "Supporter",
      sessionId: SESSION_ID,
      eventValue: JSON.stringify(data),
      occurredAt: { seconds: BigInt(Date.parse(TIME) / 1000), nanos: 0 },
    });
  });

  test("a module event the platform withheld the viewer of names nobody", () => {
    const logged: LoggedEvent = {
      subject: "kofi.donation",
      moduleId: "woofx3_kofi",
      identity: { path: "from.id", anonymousWhen: "isPrivate" },
    };
    const req = toRequest(logged, envelope("kofi.donation", { from: { id: "k-1" }, isPrivate: true }));

    expect(req).not.toBeNull();
    expect(req?.platformUserId).toBeUndefined();
  });

  test("a module event whose trigger marks no viewer is recorded unattributed, under its own platform", () => {
    const req = toRequest(
      { subject: "goal.reached", moduleId: "woofx3" },
      envelope("goal.reached", { target: "woofx3:counter:deaths" }, { platform: "system" })
    );

    expect(req?.platform).toBe("system");
    expect(req?.platformUserId).toBeUndefined();
    expect(req?.amount).toBeUndefined();
  });

  test("an id or name too long for the log costs the attribution, not the event", () => {
    const logged: LoggedEvent = {
      subject: "kofi.donation",
      moduleId: "woofx3_kofi",
      identity: { path: "id", displayName: "name" },
    };

    const longName = toRequest(logged, envelope("kofi.donation", { id: "k-1", name: "n".repeat(101) }));
    expect(longName?.platformUserId).toBe("k-1");
    expect(longName?.userName).toBeUndefined();

    const longId = toRequest(logged, envelope("kofi.donation", { id: "i".repeat(101), name: "Supporter" }));
    expect(longId).not.toBeNull();
    expect(longId?.platformUserId).toBeUndefined();
    expect(longId?.userName).toBeUndefined();
  });
});

describe("UserEventRecorder", () => {
  test("subscribes to the catalog's subjects and follows it as it changes", async () => {
    const { recorder, nats, change, unsubscribed } = setup(
      async () => ({}),
      [twitch(EventType.Follow), twitch(EventType.Cheer)]
    );
    await recorder.start();

    const subjects = () => nats.subscribe.mock.calls.map(([subject]: [string]) => subject);
    expect(subjects()).toEqual([EventType.Follow, EventType.Cheer]);

    await change([twitch(EventType.Cheer), { subject: "goal.reached", moduleId: "woofx3" }]);
    expect(subjects()).toEqual([EventType.Follow, EventType.Cheer, "goal.reached"]);
    expect(unsubscribed).toEqual([EventType.Follow]);
  });

  test("does not record a subject that has left the catalog", async () => {
    const { recorder, db, change } = setup(async () => ({}));
    await recorder.start();
    await change([]);

    await recorder.handle(EventType.Follow, makeMsg(EventType.Follow, envelope(EventType.Follow, { userId: "1" })));

    expect(db.recordUserEvent).not.toHaveBeenCalled();
  });

  test("retries a failed write with the same event id", async () => {
    let calls = 0;
    const { recorder, db, logger } = setup(async () => {
      calls++;
      if (calls < 3) {
        throw new DbError("recordUserEvent", "unavailable", "db-proxy down");
      }
      return {};
    });

    await recorder.handle(EventType.Follow, makeMsg(EventType.Follow, envelope(EventType.Follow, { userId: "1" })));

    expect(db.recordUserEvent).toHaveBeenCalledTimes(3);
    const ids = db.recordUserEvent.mock.calls.map(([req]: [{ eventId: string }]) => req.eventId);
    expect(ids).toEqual(["ce-1", "ce-1", "ce-1"]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("gives up and logs once the retries are spent", async () => {
    const { recorder, db, logger } = setup(async () => {
      throw new DbError("recordUserEvent", "unavailable", "db-proxy down");
    });

    await recorder.handle(EventType.Follow, makeMsg(EventType.Follow, envelope(EventType.Follow, { userId: "1" })));

    expect(db.recordUserEvent).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test("does not retry a write db-proxy rejected as invalid", async () => {
    const { recorder, db, logger, sleep } = setup(async () => {
      throw new DbError("recordUserEvent", "invalid_argument", "amount must not be negative");
    });

    await recorder.handle(EventType.Follow, makeMsg(EventType.Follow, envelope(EventType.Follow, { userId: "1" })));

    expect(db.recordUserEvent).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
