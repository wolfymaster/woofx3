import { EventType as SessionEventType } from "@woofx3/common/cloudevents/Session/events";
import { clearCurrentSessionId, getCurrentSessionId } from "@woofx3/common/cloudevents/session";
import { EventType } from "@woofx3/common/cloudevents/Twitch/events";
import type { Msg } from "@woofx3/nats/src/types";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { DbError } from "../src/db-client";
import { StreamSessionResolver, timestampToEpochMs } from "../src/stream-session-resolver";

const APPLICATION_ID = "app-1";
const ABSENT_TIMESTAMP = { seconds: 0n, nanos: 0 };

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

function makeMsg(subject: string, payload: unknown): Msg {
  const body = JSON.stringify({ type: subject, data: payload });
  return {
    subject,
    data: new TextEncoder().encode(body),
    json: () => JSON.parse(body),
    string: () => body,
    respond: () => false,
  };
}

function timestampFor(iso: string) {
  const ms = Date.parse(iso);
  return { seconds: BigInt(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1_000_000 };
}

function session(id: string, startedAt = "2026-01-01T00:00:00.000Z") {
  return { id, applicationId: APPLICATION_ID, status: "open", startedAt: timestampFor(startedAt) };
}

function setup(db: Record<string, unknown> = {}) {
  const handlers = new Map<string, (msg: Msg) => void>();
  const nats = {
    subscribe: mock(async (subject: string, handler: (msg: Msg) => void) => {
      handlers.set(subject, handler);
      return {} as any;
    }),
    publish: mock(async () => {}),
  } as any;

  const dbClient = {
    ensureCurrentStreamSession: mock(async () => ({
      status: { code: "OK" },
      session: session("session-1"),
      isSegmentOpen: false,
      lastSegmentEndedAt: ABSENT_TIMESTAMP,
    })),
    splitStreamSession: mock(async () => ({
      status: { code: "OK" },
      ended: session("session-1"),
      started: session("session-2"),
    })),
    openStreamSessionSegment: mock(async () => ({ id: "segment-1" })),
    closeStreamSessionSegment: mock(async () => ({ id: "segment-1" })),
    ...db,
  } as any;

  const resolver = new StreamSessionResolver(nats, dbClient, APPLICATION_ID, fakeLogger());
  return { resolver, nats, db: dbClient, handlers };
}

function published(nats: any): Array<{ type: string; data: Record<string, unknown> }> {
  return nats.publish.mock.calls.map(([, bytes]: [string, Uint8Array]) => {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return { type: parsed.type, data: parsed.data };
  });
}

beforeEach(() => {
  clearCurrentSessionId();
});

afterEach(() => {
  clearCurrentSessionId();
});

describe("timestampToEpochMs", () => {
  test("reads a real timestamp", () => {
    expect(timestampToEpochMs(timestampFor("2026-01-01T00:00:00.000Z"))).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
  });

  // The load-bearing case: protoscript fills an omitted message field with a
  // zero Timestamp, and reading that as epoch 0 would make every stream.online
  // look like a return after fifty years and split the session every time.
  test("treats the zero timestamp protoscript uses for an absent field as absent", () => {
    expect(timestampToEpochMs(ABSENT_TIMESTAMP)).toBeUndefined();
  });

  test("treats a missing field as absent", () => {
    expect(timestampToEpochMs(undefined)).toBeUndefined();
  });
});

describe("StreamSessionResolver.start", () => {
  test("subscribes to both stream lifecycle subjects", async () => {
    const { resolver, handlers } = setup();
    await resolver.start();

    expect(handlers.has(EventType.StreamOnline)).toBe(true);
    expect(handlers.has(EventType.StreamOffline)).toBe(true);
  });

  // A restarted process must not publish unstamped until the next broadcast.
  test("announces the current session and feeds the stamping holder", async () => {
    const { resolver, nats } = setup();
    await resolver.start();

    expect(resolver.currentSessionId()).toBe("session-1");
    expect(getCurrentSessionId()).toBe("session-1");
    expect(published(nats)).toEqual([
      {
        type: SessionEventType.SessionStarted,
        data: { sessionId: "session-1", applicationId: APPLICATION_ID, startedAt: "2026-01-01T00:00:00.000Z" },
      },
    ]);
  });

  test("a db failure at startup does not throw", async () => {
    const { resolver } = setup({
      ensureCurrentStreamSession: mock(async () => {
        throw new DbError("ensureCurrentStreamSession", "unavailable", "down");
      }),
    });

    await resolver.start();

    expect(resolver.currentSessionId()).toBeNull();
  });
});

describe("stream.online", () => {
  test("extends the open session, opening a segment without ending anything", async () => {
    const { resolver, nats, db, handlers } = setup();
    await resolver.start();
    nats.publish.mockClear();

    await handlers.get(EventType.StreamOnline)?.(
      makeMsg(EventType.StreamOnline, { startedAt: "2026-01-01T01:00:00.000Z" })
    );

    expect(db.splitStreamSession).not.toHaveBeenCalled();
    expect(db.openStreamSessionSegment).toHaveBeenCalledTimes(1);
    expect(published(nats)).toEqual([]);
    expect(resolver.currentSessionId()).toBe("session-1");
  });

  test("splits after a gap past the grace window, ending then starting", async () => {
    const lastEnded = "2026-01-01T00:00:00.000Z";
    const backOnline = "2026-01-01T02:00:00.000Z";
    const { resolver, nats, db, handlers } = setup({
      ensureCurrentStreamSession: mock(async () => ({
        status: { code: "OK" },
        session: session("session-1"),
        isSegmentOpen: false,
        lastSegmentEndedAt: timestampFor(lastEnded),
      })),
    });
    await resolver.start();
    nats.publish.mockClear();

    await handlers.get(EventType.StreamOnline)?.(makeMsg(EventType.StreamOnline, { startedAt: backOnline }));

    expect(db.splitStreamSession).toHaveBeenCalledTimes(1);
    expect(published(nats)).toEqual([
      {
        type: SessionEventType.SessionEnded,
        data: {
          sessionId: "session-1",
          applicationId: APPLICATION_ID,
          endedAt: backOnline,
          replacedBySessionId: "session-2",
        },
      },
      {
        type: SessionEventType.SessionStarted,
        data: { sessionId: "session-2", applicationId: APPLICATION_ID, startedAt: backOnline },
      },
    ]);
    expect(resolver.currentSessionId()).toBe("session-2");
    expect(getCurrentSessionId()).toBe("session-2");
  });

  // Twitch redelivers notifications; a duplicate must not read as a gap.
  test("a redelivered notification while live extends rather than splitting", async () => {
    const { resolver, db, handlers } = setup({
      ensureCurrentStreamSession: mock(async () => ({
        status: { code: "OK" },
        session: session("session-1"),
        isSegmentOpen: true,
        lastSegmentEndedAt: timestampFor("2020-01-01T00:00:00.000Z"),
      })),
    });
    await resolver.start();

    await handlers.get(EventType.StreamOnline)?.(
      makeMsg(EventType.StreamOnline, { startedAt: "2026-01-01T01:00:00.000Z" })
    );

    expect(db.splitStreamSession).not.toHaveBeenCalled();
  });

  // A session that has never been live has no gap to measure. Splitting here
  // would start a fresh session on the very first broadcast.
  test("a session that has never been live extends", async () => {
    const { db, resolver, handlers } = setup();
    await resolver.start();

    await handlers.get(EventType.StreamOnline)?.(
      makeMsg(EventType.StreamOnline, { startedAt: "2026-06-01T00:00:00.000Z" })
    );

    expect(db.splitStreamSession).not.toHaveBeenCalled();
    expect(db.openStreamSessionSegment).toHaveBeenCalledTimes(1);
  });

  test("accepts the snake_case spelling the twitch service may send", async () => {
    const { db, resolver, handlers } = setup();
    await resolver.start();

    await handlers.get(EventType.StreamOnline)?.(
      makeMsg(EventType.StreamOnline, { started_at: "2026-01-01T01:00:00.000Z" })
    );

    const [[call]] = (db.openStreamSessionSegment as any).mock.calls;
    expect(call.startedAt.seconds).toBe(BigInt(Date.parse("2026-01-01T01:00:00.000Z") / 1000));
  });

  // A handler that throws kills the subscription and stops delivery of
  // everything behind it.
  test("a db failure does not throw out of the handler", async () => {
    const { resolver, handlers } = setup({
      openStreamSessionSegment: mock(async () => {
        throw new DbError("openStreamSessionSegment", "internal", "boom");
      }),
    });
    await resolver.start();

    const handler = handlers.get(EventType.StreamOnline);
    expect(handler).toBeDefined();
    await expect(
      (async () => handler?.(makeMsg(EventType.StreamOnline, { startedAt: "2026-01-01T01:00:00.000Z" })))()
    ).resolves.toBeUndefined();
  });
});

describe("stream.offline", () => {
  test("closes the segment and leaves the session open", async () => {
    const { resolver, nats, db, handlers } = setup();
    await resolver.start();
    nats.publish.mockClear();

    await handlers.get(EventType.StreamOffline)?.(makeMsg(EventType.StreamOffline, {}));

    expect(db.closeStreamSessionSegment).toHaveBeenCalledTimes(1);
    // The session does not end when the stream does; that is what stops a
    // dropout wiping session-scoped state.
    expect(published(nats)).toEqual([]);
    expect(resolver.currentSessionId()).toBe("session-1");
  });

  test("a duplicate offline with no open segment is not an error", async () => {
    const { resolver, handlers } = setup({
      closeStreamSessionSegment: mock(async () => {
        throw new DbError("closeStreamSessionSegment", "not_found", "no open segment");
      }),
    });
    await resolver.start();

    const handler = handlers.get(EventType.StreamOffline);
    await expect((async () => handler?.(makeMsg(EventType.StreamOffline, {})))()).resolves.toBeUndefined();
  });
});
