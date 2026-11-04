import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EventType as SessionEventType } from "@woofx3/common/cloudevents/Session/events";
import { EventType as StreamStatusEventType } from "@woofx3/common/cloudevents/StreamStatus/events";
import { clearCurrentSessionId, getCurrentSessionId } from "@woofx3/common/cloudevents/session";
import { EventType } from "@woofx3/common/cloudevents/Twitch/events";
import type { Msg } from "@woofx3/nats/src/types";
import { DbError } from "../src/db-client";
import { DEFAULT_SESSION_GRACE_MS } from "../src/stream-session-policy";
import { StreamSessionResolver, timestampToEpochMs } from "../src/stream-session-resolver";

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
  return { id, status: "open", startedAt: timestampFor(startedAt) };
}

const JUST_AFTER_FIRST_SESSION = Date.parse("2026-01-01T00:00:00.000Z");

function setup(db: Record<string, unknown> = {}, now: () => number = () => JUST_AFTER_FIRST_SESSION) {
  const handlers = new Map<string, (msg: Msg) => void>();
  const nats = {
    subscribe: mock(async (subject: string, handler: (msg: Msg) => void) => {
      handlers.set(subject, handler);
      return {} as any;
    }),
    publish: mock(async () => {}),
  } as any;

  let splits = 0;
  const dbClient = {
    ensureCurrentStreamSession: mock(async () => ({
      status: { code: "OK" },
      session: session("session-1"),
      isSegmentOpen: false,
      lastSegmentEndedAt: ABSENT_TIMESTAMP,
    })),
    splitStreamSession: mock(async () => {
      splits += 1;
      return {
        status: { code: "OK" },
        ended: session(`session-${splits}`),
        started: session(`session-${splits + 1}`),
      };
    }),
    openStreamSessionSegment: mock(async () => ({ id: "segment-1" })),
    closeStreamSessionSegment: mock(async () => ({ id: "segment-1" })),
    ...db,
  } as any;

  const resolver = new StreamSessionResolver(nats, dbClient, fakeLogger(), null, now);
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
    expect(published(nats).filter((event) => event.type === SessionEventType.SessionStarted)).toEqual([
      {
        type: SessionEventType.SessionStarted,
        data: { sessionId: "session-1", startedAt: "2026-01-01T00:00:00.000Z" },
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

describe("the end of a broadcast", () => {
  const WENT_DOWN = "2026-03-01T20:00:00.000Z";
  const offlineSession = () =>
    mock(async () => ({
      status: { code: "OK" },
      session: session("session-1"),
      isSegmentOpen: false,
      lastSegmentEndedAt: timestampFor(WENT_DOWN),
    }));

  test("leaves the session open through the grace window", async () => {
    let now = Date.parse(WENT_DOWN);
    const { resolver, db } = setup({ ensureCurrentStreamSession: offlineSession() }, () => now);
    await resolver.start();

    now += DEFAULT_SESSION_GRACE_MS;
    await resolver.endBroadcastIfOver();

    expect(db.splitStreamSession).not.toHaveBeenCalled();
    resolver.stop();
  });

  // The regression this exists for: offline follows and subs must not land in
  // the stream's recap, so the end is the last segment's, however late the check.
  test("past the grace window, ends the session when the stream did and adopts an idle one", async () => {
    let now = Date.parse(WENT_DOWN);
    const { resolver, nats, db } = setup(
      { ensureCurrentStreamSession: offlineSession(), clearSessionScoped: mock(async () => []) },
      () => now
    );
    await resolver.start();
    nats.publish.mockClear();

    now += 6 * DEFAULT_SESSION_GRACE_MS;
    await resolver.endBroadcastIfOver();

    expect(db.splitStreamSession).toHaveBeenCalledWith({ at: timestampFor(WENT_DOWN) });
    expect(db.clearSessionScoped).toHaveBeenCalledTimes(1);
    expect(published(nats)).toEqual([
      {
        type: SessionEventType.SessionEnded,
        data: { sessionId: "session-1", endedAt: WENT_DOWN, replacedBySessionId: "session-2" },
      },
      {
        type: SessionEventType.SessionStarted,
        data: { sessionId: "session-2", startedAt: WENT_DOWN },
      },
    ]);
    expect(resolver.currentSessionId()).toBe("session-2");
    resolver.stop();
  });

  test("a stream that ended while the engine was down is settled at startup", async () => {
    const { resolver, db } = setup(
      { ensureCurrentStreamSession: offlineSession(), clearSessionScoped: mock(async () => []) },
      () => Date.parse(WENT_DOWN) + 2 * DEFAULT_SESSION_GRACE_MS
    );
    await resolver.start();

    expect(db.splitStreamSession).toHaveBeenCalledTimes(1);
    resolver.stop();
  });

  test("does nothing while the stream is live", async () => {
    const { resolver, db } = setup(
      {
        ensureCurrentStreamSession: mock(async () => ({
          status: { code: "OK" },
          session: session("session-1"),
          isSegmentOpen: true,
          lastSegmentEndedAt: timestampFor(WENT_DOWN),
        })),
      },
      () => Date.parse(WENT_DOWN) + 100 * DEFAULT_SESSION_GRACE_MS
    );
    await resolver.start();
    await resolver.endBroadcastIfOver();

    expect(db.splitStreamSession).not.toHaveBeenCalled();
    resolver.stop();
  });

  test("a failed check is logged and the next one tries again", async () => {
    const splitStreamSession = mock(async () => {
      throw new Error("db down");
    });
    const { resolver, db } = setup(
      {
        ensureCurrentStreamSession: offlineSession(),
        splitStreamSession,
      },
      () => Date.parse(WENT_DOWN) + 2 * DEFAULT_SESSION_GRACE_MS
    );
    await resolver.start();
    await resolver.endBroadcastIfOver();

    expect(db.splitStreamSession).toHaveBeenCalledTimes(2);
    resolver.stop();
  });

  test("a going-live waits for a check in progress, so it cannot be closed under the stream", async () => {
    const order: string[] = [];
    let live = false;
    let now = Date.parse(WENT_DOWN);
    const { resolver, handlers } = setup(
      {
        ensureCurrentStreamSession: mock(async () => ({
          status: { code: "OK" },
          session: session("session-1"),
          isSegmentOpen: live,
          lastSegmentEndedAt: timestampFor(WENT_DOWN),
        })),
        splitStreamSession: mock(async () => {
          order.push("split");
          return { status: { code: "OK" }, ended: session("session-1"), started: session("session-2") };
        }),
        openStreamSessionSegment: mock(async () => {
          order.push("open");
          live = true;
          return { id: "segment-1" };
        }),
        clearSessionScoped: mock(async () => []),
      },
      () => now
    );
    await resolver.start();

    now += 2 * DEFAULT_SESSION_GRACE_MS;
    const check = resolver.endBroadcastIfOver();
    const goingLive = handlers.get(EventType.StreamOnline)?.(
      makeMsg(EventType.StreamOnline, { startedAt: new Date(now).toISOString() })
    );
    await Promise.all([check, goingLive]);

    expect(order.indexOf("open")).toBe(order.length - 1);
    resolver.stop();
  });
});

describe("stream.online", () => {
  test("extends the open session within the grace window, opening a segment without ending anything", async () => {
    const { resolver, nats, db, handlers } = setup({
      ensureCurrentStreamSession: mock(async () => ({
        status: { code: "OK" },
        session: session("session-1"),
        isSegmentOpen: false,
        lastSegmentEndedAt: timestampFor("2026-01-01T00:55:00.000Z"),
      })),
    });
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

  // Reached when no check ran after the grace window, such as an engine that was
  // down. The broadcast ends where it would have, and the idle span stays apart.
  test("past the grace window, ends the session at its last segment and starts another", async () => {
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

    expect(db.splitStreamSession.mock.calls.map(([req]: [{ at: unknown }]) => req.at)).toEqual([
      timestampFor(lastEnded),
      timestampFor(backOnline),
    ]);
    expect(published(nats)).toEqual([
      {
        type: SessionEventType.SessionEnded,
        data: { sessionId: "session-1", endedAt: lastEnded, replacedBySessionId: "session-2" },
      },
      {
        type: SessionEventType.SessionStarted,
        data: { sessionId: "session-2", startedAt: lastEnded },
      },
      {
        type: SessionEventType.SessionStarted,
        data: { sessionId: "session-3", startedAt: backOnline },
      },
    ]);
    expect(resolver.currentSessionId()).toBe("session-3");
    expect(getCurrentSessionId()).toBe("session-3");
  });

  // A session value that goes away has to be announced, or everything showing
  // it (a counter on the dashboard, a widget on stream) keeps the stale value.
  test("announces each session value it clears, before the session ends", async () => {
    const { resolver, nats, handlers } = setup({
      ensureCurrentStreamSession: mock(async () => ({
        status: { code: "OK" },
        session: session("session-1"),
        isSegmentOpen: false,
        lastSegmentEndedAt: timestampFor("2026-01-01T00:00:00.000Z"),
      })),
      clearSessionScoped: mock(async () => [{ namespace: "woofx3", key: "state:woofx3:counter:deaths" }]),
    });
    await resolver.start();
    nats.publish.mockClear();

    await handlers.get(EventType.StreamOnline)?.(
      makeMsg(EventType.StreamOnline, { startedAt: "2026-01-01T02:00:00.000Z" })
    );

    const subjects = nats.publish.mock.calls.map(([subject]: [string]) => subject);
    expect(subjects[0]).toBe("module.storage.woofx3.changed");
    expect(subjects.indexOf("module.storage.woofx3.changed")).toBeLessThan(
      subjects.indexOf(SessionEventType.SessionEnded)
    );
    expect(published(nats)[0]).toMatchObject({
      type: "module.storage.changed",
      data: { moduleId: "woofx3", key: "state:woofx3:counter:deaths", value: null },
    });
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

  // Offline activity must not sit at the front of the next recap. Only a stream
  // session's end is announced: no recap follows an idle one.
  test("leaves an idle session for a new one, clearing storage without announcing an end", async () => {
    const { db, nats, resolver, handlers } = setup({
      clearSessionScoped: mock(async () => []),
    });
    await resolver.start();
    nats.publish.mockClear();

    await handlers.get(EventType.StreamOnline)?.(
      makeMsg(EventType.StreamOnline, { startedAt: "2026-06-01T00:00:00.000Z" })
    );

    expect(db.splitStreamSession).toHaveBeenCalledTimes(1);
    expect(db.clearSessionScoped).toHaveBeenCalledTimes(1);
    expect(db.openStreamSessionSegment.mock.calls[0][0].streamSessionId).toBe("session-2");
    expect(published(nats).map((event) => event.type)).toEqual([SessionEventType.SessionStarted]);
    expect(resolver.currentSessionId()).toBe("session-2");
  });

  test("a stream that began before the session extends it, as after an engine start mid-broadcast", async () => {
    const { db, resolver, handlers } = setup({
      ensureCurrentStreamSession: mock(async () => ({
        status: { code: "OK" },
        session: session("session-1", "2026-06-01T00:05:00.000Z"),
        isSegmentOpen: false,
        lastSegmentEndedAt: ABSENT_TIMESTAMP,
      })),
    });
    await resolver.start();

    await handlers.get(EventType.StreamOnline)?.(
      makeMsg(EventType.StreamOnline, { startedAt: "2026-06-01T00:00:00.000Z" })
    );

    expect(db.splitStreamSession).not.toHaveBeenCalled();
    expect(db.openStreamSessionSegment).toHaveBeenCalledTimes(1);
  });

  test("accepts the snake_case spelling the Twitch adapter may send", async () => {
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

describe("StreamSessionResolver syncing with the platforms", () => {
  const OBSERVED = StreamStatusEventType.StreamStatusObserved;
  const STARTED_AT = "2026-10-31T12:00:00.000Z";

  test("asks the platforms for their state once subscribed", async () => {
    const { resolver, nats, handlers } = setup();
    await resolver.start();
    expect(handlers.has(OBSERVED)).toBe(true);
    expect(published(nats).map((event) => event.type)).toContain(StreamStatusEventType.StreamStatusRequested);
  });

  test("still starts when asking fails", async () => {
    const { resolver, nats } = setup();
    nats.publish = mock(async (subject: string) => {
      if (subject === StreamStatusEventType.StreamStatusRequested) {
        throw new Error("bus down");
      }
    });
    await expect(resolver.start()).resolves.toBeUndefined();
  });

  test("opens a segment at the stream's own start when it is found already live", async () => {
    const { resolver, db, handlers } = setup();
    await resolver.start();
    await handlers.get(OBSERVED)?.(makeMsg(OBSERVED, { live: true, startedAt: STARTED_AT }));

    expect(db.openStreamSessionSegment).toHaveBeenCalledTimes(1);
    const [request] = db.openStreamSessionSegment.mock.calls[0];
    expect(request.startedAt).toEqual(timestampFor(STARTED_AT));
  });

  test("never publishes stream.online for a stream found already live", async () => {
    const { resolver, nats, handlers } = setup();
    await resolver.start();
    await handlers.get(OBSERVED)?.(makeMsg(OBSERVED, { live: true, startedAt: STARTED_AT }));
    expect(published(nats).map((event) => event.type)).not.toContain(EventType.StreamOnline);
  });

  test("splits a session the stream came back to long after, as going live would", async () => {
    const { resolver, db, handlers } = setup({
      ensureCurrentStreamSession: mock(async () => ({
        status: { code: "OK" },
        session: session("session-1"),
        isSegmentOpen: false,
        lastSegmentEndedAt: timestampFor("2026-10-30T12:00:00.000Z"),
      })),
    });
    await resolver.start();
    await handlers.get(OBSERVED)?.(makeMsg(OBSERVED, { live: true, startedAt: STARTED_AT }));
    expect(db.splitStreamSession).toHaveBeenCalledTimes(2);
  });

  test("uses the time it learned of it when the platform gives no start", async () => {
    const { resolver, db, handlers } = setup();
    await resolver.start();
    for (const data of [{ live: true }, { live: true, startedAt: "not a time" }]) {
      await handlers.get(OBSERVED)?.(makeMsg(OBSERVED, data));
    }
    expect(db.openStreamSessionSegment).toHaveBeenCalledTimes(2);
  });

  test("closes the open segment when the stream is found offline", async () => {
    const { resolver, db, handlers } = setup();
    await resolver.start();
    await handlers.get(OBSERVED)?.(makeMsg(OBSERVED, { live: false }));
    expect(db.closeStreamSessionSegment).toHaveBeenCalledTimes(1);
    expect(db.openStreamSessionSegment).not.toHaveBeenCalled();
  });

  test("ignores a malformed observation", async () => {
    const { resolver, db, handlers } = setup();
    await resolver.start();
    for (const data of [{}, { live: "yes" }, null]) {
      await handlers.get(OBSERVED)?.(makeMsg(OBSERVED, data));
    }
    expect(db.openStreamSessionSegment).not.toHaveBeenCalled();
    expect(db.closeStreamSessionSegment).not.toHaveBeenCalled();
  });
});
