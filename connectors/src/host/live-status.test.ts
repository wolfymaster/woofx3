import { describe, expect, test } from "bun:test";
import { EventType } from "@woofx3/common/cloudevents/StreamStatus/events";
import { LIVE_STATUS_READ_RETRY, LiveStatusBoard } from "./live-status";
import { FakeTime, flush, halfRandom, RecordingLogger, text } from "./testing";

function setup(opts: { failPublish?: boolean } = {}) {
  const time = new FakeTime();
  const published: { subject: string; event: Record<string, unknown> }[] = [];
  const logger = new RecordingLogger();
  const board = new LiveStatusBoard({
    publish: async (subject, data) => {
      if (opts.failPublish) {
        throw new Error("bus down");
      }
      published.push({ subject, event: JSON.parse(text(data)) });
    },
    random: halfRandom,
    timers: time,
    logger,
  });
  return { time, published, board, logger, signal: new AbortController() };
}

describe("LiveStatusBoard", () => {
  test("publishes what a read finds, with the platform on the event", async () => {
    const { board, published, signal } = setup();
    const startedAt = "2026-10-31T12:00:00.000Z";
    await board.forAdapter("twitch").seed(async () => ({ live: true, startedAt }), signal.signal);

    expect(published).toHaveLength(1);
    expect(published[0].subject).toBe(EventType.StreamStatusObserved);
    expect(published[0].event.platform).toBe("twitch");
    expect(published[0].event.data).toEqual({ live: true, startedAt });
  });

  test("answers a request with what is known, and nothing before that", async () => {
    const { board, published, signal } = setup();
    const handle = board.forAdapter("twitch");
    await board.publishKnown();
    expect(published).toEqual([]);

    await handle.seed(async () => ({ live: false }), signal.signal);
    published.length = 0;
    await board.publishKnown();
    expect(published.map((p) => p.event.data)).toEqual([{ live: false }]);
  });

  test("retries a failed read until it succeeds", async () => {
    const { board, published, time, signal, logger } = setup();
    let reads = 0;
    const seeded = board.forAdapter("twitch").seed(async () => {
      reads++;
      if (reads === 1) {
        throw new Error("helix down");
      }
      return { live: true };
    }, signal.signal);
    await flush();
    expect(published).toEqual([]);
    expect(logger.entries.some((entry) => entry.level === "warn")).toBe(true);

    await time.advance(LIVE_STATUS_READ_RETRY.baseMs);
    await seeded;
    expect(reads).toBe(2);
    expect(published).toHaveLength(1);
  });

  test("an aborted read stops retrying and reports nothing", async () => {
    const { board, published, signal } = setup();
    const seeded = board.forAdapter("twitch").seed(async () => {
      throw new Error("helix down");
    }, signal.signal);
    await flush();
    signal.abort();
    await seeded;
    await board.publishKnown();
    expect(published).toEqual([]);
  });

  test("an event during the read wins over it", async () => {
    const { board, published, signal } = setup();
    const handle = board.forAdapter("twitch");
    await handle.seed(async () => {
      handle.changed({ live: true, startedAt: "2026-10-31T12:00:00.000Z" });
      return { live: false };
    }, signal.signal);
    expect(published).toEqual([]);

    await board.publishKnown();
    expect(published.map((p) => p.event.data)).toEqual([{ live: true, startedAt: "2026-10-31T12:00:00.000Z" }]);
  });

  test("a stopped adapter reports nothing, and its old handle cannot bring it back", async () => {
    const { board, published, signal } = setup();
    const handle = board.forAdapter("twitch");
    await handle.seed(async () => ({ live: true }), signal.signal);
    published.length = 0;

    board.clear("twitch");
    await board.publishKnown();
    await handle.seed(async () => ({ live: true }), signal.signal);
    handle.changed({ live: true });
    await board.publishKnown();
    expect(published).toEqual([]);
  });

  test("a reset forgets the state and stops a read for the old connection", async () => {
    const { board, published, signal } = setup();
    const handle = board.forAdapter("twitch");
    handle.changed({ live: true });
    let finishRead: (status: { live: boolean }) => void = () => {};
    const seeded = handle.seed(() => new Promise((resolve) => (finishRead = resolve)), signal.signal);
    handle.reset();
    finishRead({ live: false });
    await seeded;

    await board.publishKnown();
    expect(published).toEqual([]);
  });

  test("a failed publish is logged, not thrown", async () => {
    const { board, signal, logger } = setup({ failPublish: true });
    await board.forAdapter("twitch").seed(async () => ({ live: true }), signal.signal);
    expect(logger.entries.some((entry) => entry.level === "warn")).toBe(true);
  });
});
