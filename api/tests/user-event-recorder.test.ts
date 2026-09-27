import { describe, expect, mock, test } from "bun:test";
import { EventType } from "@woofx3/common/cloudevents/Twitch/events";
import type { Msg } from "@woofx3/nats/src/types";
import { DbError } from "../src/db-client";
import { RECORDED_SUBJECTS, toRequest, UserEventRecorder } from "../src/user-event-recorder";

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

function setup(recordUserEvent: (req: unknown) => Promise<unknown>) {
  const nats = { subscribe: mock(async () => ({}) as any) } as any;
  const db = { recordUserEvent: mock(recordUserEvent) } as any;
  const logger = fakeLogger();
  const sleep = mock(async () => {});
  const recorder = new UserEventRecorder(nats, db, logger, [10, 20], sleep);
  return { recorder, nats, db, logger, sleep };
}

describe("toRequest", () => {
  test("records a cheer against its viewer, with bits, session and time", () => {
    const data = { amount: 500, isAnonymous: false, message: "hi", userId: "1001", userName: "Viewer" };
    const req = toRequest(EventType.Cheer, envelope(EventType.Cheer, data));

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
      EventType.Cheer,
      envelope(EventType.Cheer, { amount: 100, isAnonymous: true, message: "", userId: null, userName: null })
    );

    expect(req?.platformUserId).toBeUndefined();
    expect(req?.userName).toBeUndefined();
    expect(req?.amount).toBe(100n);
  });

  test("an anonymous gift is not attributed to the anonymous gifter account", () => {
    const req = toRequest(
      EventType.SubscriptionGift,
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
      EventType.SubscriptionGift,
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
    const req = toRequest(EventType.Follow, envelope(EventType.Follow, { userId: "1001", userName: "Viewer" }));

    expect(req?.platformUserId).toBe("1001");
    expect(req?.amount).toBeUndefined();
  });

  test("a raid carries its raider count", () => {
    const req = toRequest(
      EventType.Raid,
      envelope(EventType.Raid, { fromBroadcasterUserId: "2002", fromBroadcasterUserName: "Raider", viewers: 42 })
    );

    expect(req?.platformUserId).toBe("2002");
    expect(req?.amount).toBe(42n);
  });

  test("a chat-notification sub event is attributed to its chatter unless anonymous", () => {
    const base = { chatterId: "1001", chatterName: "Viewer", tier: "1000", cumulativeMonths: 7 };
    const named = toRequest(EventType.Resub, envelope(EventType.Resub, { ...base, chatterIsAnonymous: false }));
    const anonymous = toRequest(EventType.Resub, envelope(EventType.Resub, { ...base, chatterIsAnonymous: true }));

    expect(named?.platformUserId).toBe("1001");
    expect(anonymous?.platformUserId).toBeUndefined();
  });

  test("an unstamped event is still recorded, without a session", () => {
    const req = toRequest(
      EventType.Follow,
      envelope(EventType.Follow, { userId: "1001", userName: "Viewer" }, { sessionId: undefined })
    );

    expect(req).not.toBeNull();
    expect(req?.sessionId).toBeUndefined();
  });

  test("a dashboard simulation is not a fact", () => {
    const req = toRequest(
      EventType.Cheer,
      envelope(EventType.Cheer, { amount: 500, isAnonymous: false, userId: "1001" }, { source: "api" })
    );

    expect(req).toBeNull();
  });

  test("an event with no id or no platform is not recorded", () => {
    const data = { userId: "1001", userName: "Viewer" };

    expect(toRequest(EventType.Follow, envelope(EventType.Follow, data, { id: undefined }))).toBeNull();
    expect(toRequest(EventType.Follow, envelope(EventType.Follow, data, { platform: undefined }))).toBeNull();
  });

  test("chat and shared-chat subjects are not recorded", () => {
    expect(toRequest(EventType.ChatMessage, envelope(EventType.ChatMessage, {}))).toBeNull();
    expect(RECORDED_SUBJECTS).not.toContain(EventType.ChatMessage);
    expect(RECORDED_SUBJECTS).not.toContain(EventType.SharedSubscribe);
    expect(RECORDED_SUBJECTS).not.toContain(EventType.SharedSubscriptionGift);
    expect(RECORDED_SUBJECTS).not.toContain(EventType.SharedRaid);
  });
});

describe("UserEventRecorder", () => {
  test("subscribes to every recorded subject", async () => {
    const { recorder, nats } = setup(async () => ({}));
    await recorder.start();

    const subjects = nats.subscribe.mock.calls.map(([subject]: [string]) => subject);
    expect(subjects).toEqual([...RECORDED_SUBJECTS]);
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
