import { describe, expect, it, mock } from "bun:test";
import { EngineEventType, SESSION_SUMMARY_SCHEMA_VERSION, type SessionSummaryEvent } from "@woofx3/api/webhooks";
import type * as stream_gauge from "@woofx3/db/stream_gauge.pb";
import type * as stream_session from "@woofx3/db/stream_session.pb";
import type * as user_event from "@woofx3/db/user_event.pb";
import type { Msg } from "@woofx3/nats/src/types";
import { buildSessionSummary, SessionSummaryEmitter } from "../src/session-summary-emitter";

const SESSION = "7f0c5a1e-0000-4000-8000-000000000001";

function at(iso: string): { seconds: bigint; nanos: number } {
  const ms = Date.parse(iso);
  return { seconds: BigInt(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1_000_000 };
}

const CLOSED: stream_session.StreamSession = {
  id: SESSION,
  status: "closed",
  startedAt: at("2026-09-01T18:00:00Z"),
  endedAt: at("2026-09-02T18:00:00Z"),
  createdAt: at("2026-09-01T18:00:00Z"),
  updatedAt: at("2026-09-02T18:00:00Z"),
};

const SEGMENT: stream_session.StreamSessionSegment = {
  id: "seg-1",
  streamSessionId: SESSION,
  startedAt: at("2026-09-01T18:05:00Z"),
  endedAt: at("2026-09-01T21:00:00Z"),
  createdAt: at("2026-09-01T18:05:00Z"),
  updatedAt: at("2026-09-01T21:00:00Z"),
};

const TOTALS: user_event.StreamSessionEventTotals = {
  bits: 1500n,
  cheers: 4n,
  subs: 6n,
  giftedSubs: 10n,
  follows: 12n,
  raids: 1n,
  raiders: 42n,
};

const ZERO: user_event.StreamSessionEventTotals = {
  bits: 0n,
  cheers: 0n,
  subs: 0n,
  giftedSubs: 0n,
  follows: 0n,
  raids: 0n,
  raiders: 0n,
};

function sample(minute: string, viewerCount?: bigint): stream_gauge.StreamGaugeSample {
  return {
    id: `g-${minute}`,
    segmentId: "seg-1",
    sessionId: SESSION,
    sampledAt: at(minute),
    createdAt: at(minute),
    ...(viewerCount !== undefined ? { viewerCount } : {}),
  };
}

interface Fake {
  session?: { session: stream_session.StreamSession; segments: stream_session.StreamSessionSegment[] } | null;
  totals?: user_event.StreamSessionEventTotals | null;
  samples?: stream_gauge.StreamGaugeSample[] | null;
}

function fakeDb(fake: Fake) {
  return {
    async findStreamSession() {
      return fake.session === undefined ? { session: CLOSED, segments: [SEGMENT] } : fake.session;
    },
    async findStreamSessionEventTotals() {
      return fake.totals === undefined ? TOTALS : fake.totals;
    },
    async findStreamGaugeSamples() {
      return fake.samples === undefined ? [] : fake.samples;
    },
  } as never;
}

function fakeLogger() {
  return { debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) } as never;
}

function makeMsg(subject: string, body: unknown): Msg {
  const payload = JSON.stringify(body);
  return {
    subject,
    data: new TextEncoder().encode(payload),
    json: () => JSON.parse(payload),
    string: () => payload,
    respond: () => false,
  };
}

describe("buildSessionSummary", () => {
  it("carries the closed session, its segments and its totals", async () => {
    const now = new Date("2026-09-02T18:00:01Z");
    const summary = await buildSessionSummary(
      fakeDb({ samples: [sample("2026-09-01T18:06:00Z", 30n), sample("2026-09-01T18:07:00Z", 50n)] }),
      SESSION,
      now
    );
    expect(summary).toEqual({
      type: EngineEventType.SESSION_SUMMARY,
      sessionId: SESSION,
      schemaVersion: SESSION_SUMMARY_SCHEMA_VERSION,
      generatedAt: "2026-09-02T18:00:01.000Z",
      session: {
        id: SESSION,
        status: "closed",
        startedAt: "2026-09-01T18:00:00.000Z",
        endedAt: "2026-09-02T18:00:00.000Z",
        segments: [{ id: "seg-1", startedAt: "2026-09-01T18:05:00.000Z", endedAt: "2026-09-01T21:00:00.000Z" }],
      },
      totals: {
        bits: 1500,
        cheers: 4,
        subs: 6,
        giftedSubs: 10,
        follows: 12,
        raids: 1,
        raiders: 42,
        peakViewers: 50,
        averageViewers: 40,
        viewerSampleMinutes: 2,
      },
    } satisfies SessionSummaryEvent);
  });

  it("summarises a session that was never live as zeroes with no viewer figures", async () => {
    const summary = await buildSessionSummary(
      fakeDb({ session: { session: CLOSED, segments: [] }, totals: ZERO, samples: [] }),
      SESSION
    );
    expect(summary?.session.segments).toEqual([]);
    expect(summary?.totals).toEqual({
      bits: 0,
      cheers: 0,
      subs: 0,
      giftedSubs: 0,
      follows: 0,
      raids: 0,
      raiders: 0,
      peakViewers: null,
      averageViewers: null,
      viewerSampleMinutes: 0,
    });
  });

  it("returns null for a session that no longer exists", async () => {
    expect(await buildSessionSummary(fakeDb({ session: null }), SESSION)).toBeNull();
    expect(await buildSessionSummary(fakeDb({ totals: null, samples: null }), SESSION)).toBeNull();
  });

  it("carries no per-viewer detail", async () => {
    const summary = await buildSessionSummary(fakeDb({}), SESSION);
    const json = JSON.stringify(summary);
    expect(json).not.toContain("platformUserId");
    expect(json).not.toContain("userName");
  });
});

describe("SessionSummaryEmitter", () => {
  function setup(fake: Fake = {}) {
    const handlers = new Map<string, (msg: Msg) => Promise<void>>();
    const nats = {
      subscribe: mock(async (subject: string, handler: (msg: Msg) => Promise<void>) => {
        handlers.set(subject, handler);
        return {};
      }),
    } as never;
    const sent: SessionSummaryEvent[] = [];
    const webhook = {
      send: mock(async (event: SessionSummaryEvent) => {
        sent.push(event);
      }),
    } as never;
    const logger = fakeLogger();
    const emitter = new SessionSummaryEmitter(nats, fakeDb(fake), webhook, logger);
    return { emitter, handlers, sent, logger };
  }

  it("sends a summary when a session ends", async () => {
    const { emitter, handlers, sent } = setup();
    await emitter.start();
    const handler = handlers.get("session.ended");
    expect(handler).toBeDefined();
    await handler?.(
      makeMsg("session.ended", {
        type: "session.ended",
        data: { sessionId: SESSION, endedAt: "2026-09-02T18:00:00.000Z", replacedBySessionId: "next" },
      })
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.sessionId).toBe(SESSION);
    expect(sent[0]?.type).toBe(EngineEventType.SESSION_SUMMARY);
  });

  it("re-sends the same session as a whole snapshot with a newer generatedAt", async () => {
    const { emitter, sent } = setup();
    await emitter.summarise(SESSION);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await emitter.summarise(SESSION);
    expect(sent).toHaveLength(2);
    expect(sent[0]?.sessionId).toBe(sent[1]?.sessionId);
    expect(sent[1]?.totals).toEqual(sent[0]?.totals);
    expect(Date.parse(sent[1]?.generatedAt ?? "")).toBeGreaterThan(Date.parse(sent[0]?.generatedAt ?? ""));
  });

  it("sends nothing for a session a merge removed", async () => {
    const { emitter, sent } = setup({ session: null });
    expect(await emitter.summarise(SESSION)).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("drops a session.ended with no session id", async () => {
    const { emitter, handlers, sent } = setup();
    await emitter.start();
    await handlers.get("session.ended")?.(makeMsg("session.ended", { data: {} }));
    expect(sent).toHaveLength(0);
  });

  it("swallows a failed read so the subscription keeps running", async () => {
    const { emitter, handlers, sent } = setup({ totals: { ...TOTALS, bits: 2n ** 60n } });
    await emitter.start();
    await handlers.get("session.ended")?.(makeMsg("session.ended", { data: { sessionId: SESSION } }));
    expect(sent).toHaveLength(0);
  });
});
