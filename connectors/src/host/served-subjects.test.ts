import { describe, expect, test } from "bun:test";
import type { ServedSubject, Unavailable } from "./adapter";
import { HostRequests } from "./host-requests";
import type { LinkState } from "./link-readers";
import { ScopeCounters, ScopedBus } from "./scoped-bus";
import { ServedSubjects } from "./served-subjects";
import { Supervisor } from "./supervisor";
import {
  bytes,
  countingIds,
  disabled,
  FakeAdapter,
  FakeBus,
  FakeTime,
  flush,
  halfRandom,
  linked,
  RecordingLogger,
  text,
} from "./testing";

function servedSubject(subject: string, budgetMs: number, handle?: ServedSubject["handle"]): ServedSubject {
  return {
    subject,
    budgetMs,
    handle: handle ?? (async (request) => bytes(`answered ${text(request)}`)),
    unavailableReply: (unavailable: Unavailable) =>
      bytes(`unavailable ${unavailable.reason} connected=${unavailable.link?.connected ?? "unknown"}`),
  };
}

async function setup(serves: ServedSubject[]) {
  const time = new FakeTime();
  const bus = new FakeBus();
  const logger = new RecordingLogger();
  const adapter = new FakeAdapter("twitch", serves);
  const supervisor = new Supervisor(
    new Map([["twitch", adapter]]),
    {
      backoff: { baseMs: 1_000, maxMs: 300_000 },
      park: { afterFailures: 1, windowMs: 600_000 },
      stopDeadlineMs: 10_000,
      subscriptionLimits: { concurrency: 4, queueCap: 8 },
    },
    { bus, dbProxyUrl: "http://db.test", clock: time, random: halfRandom, timers: time, logger }
  );
  const requests = new HostRequests({ clock: time, ids: countingIds(), timers: time, logger });
  const scope = new ScopedBus({
    scope: "host",
    client: bus,
    grants: { publishes: [], subscribes: serves.map((s) => s.subject), requests: [] },
    limits: { concurrency: 8, queueCap: 8 },
    logger,
    counters: new ScopeCounters(),
  });
  const served = new ServedSubjects({ requests, scope, adapters: supervisor, logger });
  await served.serveAll("twitch", serves);
  const apply = (link: LinkState) => supervisor.reconcile(new Map([["twitch", link]]), new Set(["twitch"] as const));
  const ask = (subject: string, body = "ping") => bus.deliver(subject, bytes(body), "inbox");
  return { time, bus, adapter, supervisor, requests, apply, ask };
}

describe("ServedSubjects", () => {
  test("answers at once while the adapter is stopped, passing its link state", async () => {
    const { apply, ask } = await setup([servedSubject("twitchapi", 9_000)]);
    await apply(disabled);

    const replies = ask("twitchapi");
    await flush();
    expect(replies.map(text)).toEqual(["unavailable stopped connected=true"]);
  });

  test("answers at once while the adapter is parked", async () => {
    const { adapter, apply, ask } = await setup([servedSubject("twitchapi", 9_000)]);
    adapter.defaultStart = "reject";
    await apply(linked);

    const replies = ask("twitchapi");
    await flush();
    expect(replies.map(text)).toEqual(["unavailable parked connected=true"]);
  });

  test("the adapter's handler answers while it is connected", async () => {
    const { apply, ask } = await setup([servedSubject("twitchapi", 9_000)]);
    await apply(linked);

    const replies = ask("twitchapi", "hello");
    await flush();
    expect(replies.map(text)).toEqual(["answered hello"]);
  });

  test("holds a request while the adapter starts, then lets the handler answer it", async () => {
    const { adapter, apply, ask, time } = await setup([servedSubject("twitchapi", 9_000)]);
    adapter.startSteps = ["hang"];
    void apply(linked);
    await flush();

    const replies = ask("twitchapi", "early");
    await time.advance(5_000);
    expect(replies).toHaveLength(0);
    adapter.finishStart();
    await flush();
    expect(replies.map(text)).toEqual(["answered early"]);
  });

  test("holds each request only for its own subject's budget", async () => {
    const { adapter, apply, ask, time } = await setup([
      servedSubject("engine.obs.status", 2_500),
      servedSubject("twitchapi", 9_000),
    ]);
    adapter.startSteps = ["hang"];
    void apply(linked);
    await flush();

    const status = ask("engine.obs.status");
    const helix = ask("twitchapi");
    await flush();
    await time.advance(2_499);
    expect(status).toHaveLength(0);
    await time.advance(1);
    expect(status.map(text)).toEqual(["unavailable starting connected=true"]);
    expect(helix).toHaveLength(0);
    await time.advance(6_500);
    expect(helix.map(text)).toEqual(["unavailable starting connected=true"]);
  });

  test("a held request is answered at once when the start is called off", async () => {
    const { adapter, apply, ask } = await setup([servedSubject("twitchapi", 9_000)]);
    adapter.startSteps = ["hang"];
    void apply(linked);
    await flush();

    const replies = ask("twitchapi");
    await flush();
    await apply(disabled);
    await flush();
    expect(replies.map(text)).toEqual(["unavailable stopped connected=true"]);
  });

  test("a throwing handler counts against the adapter and replies stopped", async () => {
    const { apply, ask, supervisor } = await setup([
      servedSubject("twitchapi", 9_000, async () => {
        throw new Error("helix exploded");
      }),
    ]);
    await apply(linked);

    const replies = ask("twitchapi");
    await flush();
    expect(replies.map(text)).toEqual(["unavailable stopped connected=true"]);
    expect(supervisor.report()[0].counts.servedErrors).toBe(1);
  });

  test("each request is answered exactly once across a stop and start, by one subscription", async () => {
    const { adapter, apply, ask, bus, time } = await setup([servedSubject("twitchapi", 9_000)]);
    adapter.startSteps = ["hang", "resolve"];
    void apply(linked);
    await flush();

    const held = ask("twitchapi", "held");
    adapter.finishStart();
    await flush();
    await apply(disabled);
    const whileStopped = ask("twitchapi", "stopped");
    await flush();
    await apply(linked);
    const afterRestart = ask("twitchapi", "again");
    await time.advance(20_000);

    expect(held.map(text)).toEqual(["answered held"]);
    expect(whileStopped.map(text)).toEqual(["unavailable stopped connected=true"]);
    expect(afterRestart.map(text)).toEqual(["answered again"]);
    expect(bus.active("twitchapi")).toBe(1);
  });
});
