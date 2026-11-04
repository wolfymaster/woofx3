import { describe, expect, it, mock } from "bun:test";
import type { CallbackEnvelope } from "@woofx3/api/webhooks";
import { EventShipper, type EventShipperConfig, type Sleep } from "../src/event-shipper";

const TARGET = { url: "https://queue.example/v1/engine-events", token: "events-token" };

const CONFIG: EventShipperConfig = {
  maxBuffered: 1_000,
  maxPostEvents: 50,
  timeoutMs: 1_000,
  backoffBaseMs: 1_000,
  backoffMaxMs: 4_000,
  drainTimeoutMs: 60_000,
};

function fakeLogger() {
  return { debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) } as any;
}

function envelope(id: string): CallbackEnvelope {
  return {
    specversion: "1.0",
    id,
    source: "engine",
    type: "workflow.created",
    time: "2026-11-04T00:00:00.000Z",
    data: { type: "workflow.created" },
  } as unknown as CallbackEnvelope;
}

function untilAborted(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    signal?.addEventListener("abort", () => resolve(), { once: true });
  });
}

/** Backoff waits pass at once and are recorded; the drain wait lasts until `stop` cancels it. */
function recordingSleep(config: EventShipperConfig) {
  const delays: number[] = [];
  const sleep: Sleep = (ms, signal) => {
    if (ms >= config.drainTimeoutMs) {
      return untilAborted(signal);
    }
    delays.push(ms);
    return Promise.resolve();
  };
  return { delays, sleep };
}

interface Post {
  url: string;
  headers: Record<string, string>;
  ids: string[];
}

/** A fetch answering each POST with the next status in `statuses`, then 202. */
function scriptedFetch(statuses: (number | Error)[] = []) {
  const posts: Post[] = [];
  const fetch = mock(async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { events: CallbackEnvelope[] };
    posts.push({ url, headers: init.headers as Record<string, string>, ids: body.events.map((e) => e.id) });
    const next = statuses.shift() ?? 202;
    if (next instanceof Error) {
      throw next;
    }
    return new Response(null, { status: next });
  });
  return { posts, fetch: fetch as unknown as typeof globalThis.fetch };
}

function shipper(overrides: Partial<EventShipperConfig> = {}, statuses: (number | Error)[] = []) {
  const config = { ...CONFIG, ...overrides };
  const logger = fakeLogger();
  const { delays, sleep } = recordingSleep(config);
  const { posts, fetch } = scriptedFetch(statuses);
  const s = new EventShipper({ logger, config, random: { next: () => 0.5 }, sleep, fetch });
  s.start();
  return { s, logger, delays, posts };
}

function ids(n: number, from = 1): string[] {
  return Array.from({ length: n }, (_, i) => `e${i + from}`);
}

describe("EventShipper", () => {
  it("keeps order across a burst and sends at most maxPostEvents per POST", async () => {
    const { s, posts } = shipper();
    for (const id of ids(120)) {
      s.ship(TARGET, envelope(id));
    }
    await s.stop();

    expect(posts.flatMap((p) => p.ids)).toEqual(ids(120));
    expect(posts.every((p) => p.ids.length <= CONFIG.maxPostEvents)).toBe(true);
    expect(posts.length).toBeLessThanOrEqual(4);
    expect(posts[0].url).toBe(TARGET.url);
    expect(posts[0].headers.Authorization).toBe("Bearer events-token");
  });

  it("retries a 503 with growing delay, capped, then delivers once accepted", async () => {
    const { s, delays, posts } = shipper({}, [503, 429, 408, new Error("ECONNRESET"), 503]);
    s.ship(TARGET, envelope("e1"));
    await s.stop();

    // Ceilings 1000, 2000, 4000, then held at the 4000 cap; jitter 0.5 halves each.
    expect(delays).toEqual([500, 1000, 2000, 2000, 2000]);
    expect(posts.map((p) => p.ids)).toEqual(Array(6).fill(["e1"]));
  });

  it("resets the backoff after a success", async () => {
    const { s, delays } = shipper({ maxPostEvents: 1 }, [503, 503, 202, 503]);
    s.ship(TARGET, envelope("e1"));
    s.ship(TARGET, envelope("e2"));
    await s.stop();

    expect(delays).toEqual([500, 1000, 500]);
  });

  it("drops a batch the target answers 401, logs it, and moves on", async () => {
    const { s, logger, posts, delays } = shipper({ maxPostEvents: 1 }, [401]);
    s.ship(TARGET, envelope("e1"));
    s.ship(TARGET, envelope("e2"));
    await s.stop();

    expect(posts.map((p) => p.ids)).toEqual([["e1"], ["e2"]]);
    expect(delays).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      "EventShipper: target refused the token, dropping events",
      expect.objectContaining({ status: 401, envelopeIds: ["e1"] })
    );
  });

  it("drops a batch refused with another 4xx without retrying", async () => {
    const { s, logger, posts } = shipper({}, [400]);
    s.ship(TARGET, envelope("e1"));
    await s.stop();

    expect(posts).toHaveLength(1);
    expect(logger.error).toHaveBeenCalledWith(
      "EventShipper: target refused the events, dropping them",
      expect.objectContaining({ status: 400 })
    );
  });

  it("drops the oldest when the buffer is full and logs the count", async () => {
    const config = { ...CONFIG, maxBuffered: 3, maxPostEvents: 1 };
    const logger = fakeLogger();
    const { sleep } = recordingSleep(config);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delivered: string[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      await gate;
      delivered.push(...(JSON.parse(init.body as string) as { events: CallbackEnvelope[] }).events.map((e) => e.id));
      return new Response(null, { status: 202 });
    }) as unknown as typeof globalThis.fetch;
    const s = new EventShipper({ logger, config, random: { next: () => 0.5 }, sleep, fetch });
    s.start();

    for (const id of ids(6)) {
      s.ship(TARGET, envelope(id));
    }
    release();
    await s.stop();

    expect(delivered).toEqual(["e1", "e4", "e5", "e6"]);
    expect(logger.error).toHaveBeenCalledWith(
      "EventShipper: buffer full, dropping the oldest events",
      expect.objectContaining({ maxBuffered: 3 })
    );
    expect(logger.error).toHaveBeenCalledWith(
      "EventShipper: events were dropped while the buffer was full",
      expect.objectContaining({ dropped: 2 })
    );
  });

  it("stop gives up after drainTimeoutMs on a target that never answers, and logs what it abandoned", async () => {
    const logger = fakeLogger();
    const fetch = ((_url: string, init: RequestInit) =>
      untilAborted(init.signal ?? undefined).then(() => {
        throw new Error("aborted");
      })) as unknown as typeof globalThis.fetch;
    // Every wait, the drain timeout included, passes at once.
    const s = new EventShipper({ logger, config: CONFIG, random: { next: () => 0.5 }, sleep: async () => {}, fetch });
    s.start();
    s.ship(TARGET, envelope("e1"));
    s.ship(TARGET, envelope("e2"));

    await s.stop();

    expect(logger.error).toHaveBeenCalledWith("EventShipper: stopped with events undelivered", { abandoned: 2 });
  });

  it("drops what is shipped after stop", async () => {
    const { s, logger, posts } = shipper();
    await s.stop();
    s.ship(TARGET, envelope("late"));

    expect(posts).toHaveLength(0);
    expect(logger.error).toHaveBeenCalledWith(
      "EventShipper: dropped an event shipped while stopped",
      expect.objectContaining({ envelopeId: "late" })
    );
  });

  it("refuses a config whose buffer is smaller than one POST", () => {
    expect(
      () =>
        new EventShipper({
          logger: fakeLogger(),
          config: { ...CONFIG, maxBuffered: 10, maxPostEvents: 50 },
          random: { next: () => 0.5 },
          sleep: async () => {},
          fetch,
        })
    ).toThrow("maxBuffered >= maxPostEvents");
  });
});
