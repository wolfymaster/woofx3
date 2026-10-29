import { describe, expect, test } from "bun:test";
import type { LinkState } from "./link-readers";
import { Supervisor, type SupervisorConfig } from "./supervisor";
import {
  bytes,
  disabled,
  FakeAdapter,
  FakeBus,
  FakeTime,
  flush,
  halfRandom,
  linked,
  noCompanion,
  RecordingLogger,
  unlinked,
} from "./testing";

const config: SupervisorConfig = {
  backoff: { baseMs: 1_000, maxMs: 300_000 },
  park: { afterFailures: 5, windowMs: 600_000 },
  stopDeadlineMs: 10_000,
  subscriptionLimits: { concurrency: 4, queueCap: 8 },
};

function setup(adapter = new FakeAdapter()) {
  const time = new FakeTime();
  // Lets a test put the supervisor's clock a little behind its timers, as real timers can be.
  const skew = { ms: 0 };
  const clock = { now: () => time.now() + skew.ms };
  const bus = new FakeBus();
  const logger = new RecordingLogger();
  const supervisor = new Supervisor(new Map([["twitch", adapter]]), config, {
    bus,
    dbProxy: { baseURL: "http://db.test" },
    companion: noCompanion,
    clock,
    random: halfRandom,
    timers: time,
    logger,
  });
  const apply = (link: LinkState, changed = false) =>
    supervisor.reconcile(new Map([["twitch", link]]), new Set(changed ? (["twitch"] as const) : []));
  return { adapter, time, skew, bus, logger, supervisor, apply };
}

describe("Supervisor", () => {
  test("starts an adapter once it is linked and enabled, and stops it when disabled", async () => {
    const { adapter, supervisor, apply } = setup();

    await apply(unlinked);
    expect(supervisor.status("twitch").state).toBe("stopped");
    expect(adapter.starts).toBe(0);

    await apply(linked, true);
    expect(supervisor.status("twitch")).toEqual({ state: "connected", since: expect.any(Number) });
    expect(adapter.starts).toBe(1);

    await apply(disabled, true);
    expect(supervisor.status("twitch").state).toBe("stopped");
    expect(adapter.stops).toBe(1);
  });

  test("never starts an adapter twice while a start is in flight", async () => {
    const adapter = new FakeAdapter();
    adapter.startSteps = ["hang"];
    const { supervisor, apply } = setup(adapter);

    const first = apply(linked, true);
    const second = apply(linked, true);
    await flush();
    expect(supervisor.status("twitch").state).toBe("starting");
    adapter.finishStart();
    await Promise.all([first, second]);

    expect(adapter.starts).toBe(1);
    expect(adapter.maxRunning).toBe(1);
    expect(supervisor.status("twitch").state).toBe("connected");
  });

  test("a failed start leaves it degraded and retries after the backoff", async () => {
    const adapter = new FakeAdapter();
    adapter.startSteps = ["reject"];
    const { supervisor, time, apply } = setup(adapter);

    await apply(linked, true);
    const status = supervisor.status("twitch");
    // Full jitter with the random source at 0.5 waits half of the 1 s base.
    expect(status).toEqual({ state: "degraded", reason: "could not connect", retryAt: time.now() + 500 });

    await time.advance(499);
    expect(adapter.starts).toBe(1);
    await time.advance(1);
    await supervisor.whenIdle();
    expect(adapter.starts).toBe(2);
    expect(supervisor.status("twitch").state).toBe("connected");
  });

  test("backoff grows with each failure and resets once connected", async () => {
    const adapter = new FakeAdapter();
    adapter.startSteps = ["reject", "reject", "resolve", "reject"];
    const { supervisor, time, apply } = setup(adapter);

    await apply(linked, true);
    const delays: number[] = [];
    const retryIn = () => {
      const status = supervisor.status("twitch");
      if (status.state !== "degraded") {
        throw new Error(`expected degraded, got ${status.state}`);
      }
      return status.retryAt - time.now();
    };
    delays.push(retryIn());
    await time.advance(delays[0]);
    delays.push(retryIn());
    await time.advance(delays[1]);
    expect(supervisor.status("twitch").state).toBe("connected");

    adapter.lastContext?.reportFault("connection lost");
    await supervisor.whenIdle();
    delays.push(retryIn());
    expect(delays).toEqual([500, 1_000, 500]);
  });

  test("parks after the configured failures in the window, and a settings change unparks it", async () => {
    const adapter = new FakeAdapter();
    adapter.defaultStart = "reject";
    const { supervisor, time, logger, apply } = setup(adapter);

    await apply(linked, true);
    for (let i = 0; i < 10; i++) {
      await time.advance(300_000);
    }
    expect(adapter.starts).toBe(5);
    expect(supervisor.status("twitch")).toEqual({ state: "parked", reason: "could not connect" });
    expect(logger.at("error").some((entry) => entry.message.includes("parked"))).toBe(true);

    // The backstop pass names no adapter, so it leaves a parked one alone.
    await apply(linked);
    expect(adapter.starts).toBe(5);

    adapter.defaultStart = "resolve";
    await apply(linked, true);
    expect(adapter.starts).toBe(6);
    expect(supervisor.status("twitch").state).toBe("connected");
  });

  test("failures spread wider than the window do not park", async () => {
    const { adapter, supervisor, time, apply } = setup();
    await apply(linked, true);

    for (let i = 0; i < 8; i++) {
      await time.advance(200_000);
      adapter.lastContext?.reportFault("connection lost");
      await supervisor.whenIdle();
      expect(supervisor.status("twitch").state).toBe("degraded");
      await time.advance(1_000);
      expect(supervisor.status("twitch").state).toBe("connected");
    }
    // Eight failures in all, but never five inside any ten minutes.
    expect(supervisor.report()[0].counts.faults).toBe(8);
  });

  test("a disabled parked adapter goes to stopped", async () => {
    const adapter = new FakeAdapter();
    adapter.defaultStart = "reject";
    const { supervisor, time, apply } = setup(adapter);
    await apply(linked, true);
    for (let i = 0; i < 10; i++) {
      await time.advance(300_000);
    }
    expect(supervisor.status("twitch").state).toBe("parked");

    await apply(disabled, true);
    expect(supervisor.status("twitch").state).toBe("stopped");
  });

  test("a retry timer that fires just before retryAt on the clock still retries", async () => {
    const adapter = new FakeAdapter();
    adapter.startSteps = ["reject"];
    const { supervisor, time, skew, apply } = setup(adapter);

    await apply(linked, true);
    expect(supervisor.status("twitch").state).toBe("degraded");
    skew.ms = -1;
    await time.advance(500);
    await supervisor.whenIdle();
    expect(adapter.starts).toBe(2);
    expect(supervisor.status("twitch").state).toBe("connected");
  });

  test("disabling a parked adapter forgets its failures, so one failure after re-enabling only degrades it", async () => {
    const adapter = new FakeAdapter();
    adapter.defaultStart = "reject";
    const { supervisor, time, apply } = setup(adapter);
    await apply(linked, true);
    for (let i = 0; i < 10; i++) {
      await time.advance(300_000);
    }
    expect(supervisor.status("twitch").state).toBe("parked");

    await apply(disabled, true);
    await apply(linked, true);
    // Back at the base backoff: full jitter at 0.5 of the 1 s base.
    expect(supervisor.status("twitch")).toEqual({
      state: "degraded",
      reason: "could not connect",
      retryAt: time.now() + 500,
    });
  });

  test("an adapter whose desired() throws is treated as not desired", async () => {
    const adapter = new FakeAdapter();
    adapter.desired = () => {
      throw new Error("bad link shape");
    };
    const { supervisor, logger, apply } = setup(adapter);

    await apply(linked, true);
    expect(supervisor.status("twitch").state).toBe("stopped");
    expect(adapter.starts).toBe(0);
    expect(logger.at("error").some((entry) => entry.message.includes("desired() threw"))).toBe(true);
  });

  test("a hung stop and a hung bus close share one stop deadline", async () => {
    const adapter = new FakeAdapter();
    adapter.stopStep = "hang";
    const { supervisor, bus, time, apply } = setup(adapter);
    await apply(linked, true);
    await adapter.lastContext?.bus.subscribe("fake.in", () => new Promise<void>(() => {}));
    bus.deliver("fake.in", bytes("held"));
    await flush();

    let stopped = false;
    void supervisor.stopAll().then(() => {
      stopped = true;
    });
    await time.advance(config.stopDeadlineMs);
    expect(stopped).toBe(true);
    expect(supervisor.status("twitch").state).toBe("stopped");
    expect(supervisor.report()[0].counts.stopTimeouts).toBe(2);
    expect(bus.active("fake.in")).toBe(0);
  });

  test("an aborted start that ignores its abort, then hangs its stop and bus close, is released within one stop deadline", async () => {
    const adapter = new FakeAdapter();
    adapter.startSteps = ["ignoreAbort"];
    adapter.stopStep = "hang";
    const { supervisor, bus, time, apply } = setup(adapter);
    void apply(linked, true);
    await flush();
    await adapter.lastContext?.bus.subscribe("fake.in", () => new Promise<void>(() => {}));
    bus.deliver("fake.in", bytes("held"));
    await flush();

    let stopped = false;
    void supervisor.stopAll().then(() => {
      stopped = true;
    });
    await time.advance(config.stopDeadlineMs);
    expect(stopped).toBe(true);
    expect(supervisor.status("twitch").state).toBe("stopped");
  });

  test("a stop that hangs is abandoned at the stop deadline and the adapter marked stopped", async () => {
    const adapter = new FakeAdapter();
    adapter.stopStep = "hang";
    const { supervisor, time, logger, apply } = setup(adapter);
    await apply(linked, true);

    const stopping = apply(disabled, true);
    await flush();
    expect(supervisor.status("twitch").state).toBe("stopping");
    await time.advance(10_000);
    await stopping;

    expect(supervisor.status("twitch").state).toBe("stopped");
    expect(supervisor.report()[0].counts.stopTimeouts).toBe(1);
    expect(logger.at("error").some((entry) => entry.message.includes("stop deadline"))).toBe(true);
  });

  test("disabling during a start aborts it", async () => {
    const adapter = new FakeAdapter();
    adapter.startSteps = ["hang"];
    const { supervisor, apply } = setup(adapter);

    const starting = apply(linked, true);
    await flush();
    await apply(disabled, true);
    await starting;

    expect(supervisor.status("twitch").state).toBe("stopped");
    expect(adapter.stops).toBe(1);
    expect(adapter.running).toBe(0);
  });

  test("a start that ignores its abort is given up on at the stop deadline", async () => {
    const adapter = new FakeAdapter();
    adapter.startSteps = ["ignoreAbort"];
    const { supervisor, time, apply } = setup(adapter);

    void apply(linked, true);
    await flush();
    const stopping = apply(disabled, true);
    await time.advance(10_000);
    await stopping;

    expect(supervisor.status("twitch").state).toBe("stopped");
    expect(supervisor.report()[0].counts.stopTimeouts).toBe(1);
  });

  test("a fault from an earlier run is ignored", async () => {
    const { adapter, supervisor, apply } = setup();
    await apply(linked, true);
    const firstRun = adapter.lastContext;
    await apply(disabled, true);
    await apply(linked, true);

    firstRun?.reportFault("stale");
    await supervisor.whenIdle();
    expect(supervisor.status("twitch").state).toBe("connected");
    expect(supervisor.report()[0].counts.faults).toBe(0);
  });

  test("stopping closes every subscription the adapter made", async () => {
    const { adapter, bus, apply } = setup();
    await apply(linked, true);
    await adapter.lastContext?.bus.subscribe("fake.in", () => {});
    expect(bus.active("fake.in")).toBe(1);

    await apply(disabled, true);
    expect(bus.active("fake.in")).toBe(0);

    await apply(linked, true);
    await adapter.lastContext?.bus.subscribe("fake.in", () => {});
    expect(bus.active("fake.in")).toBe(1);
  });

  test("stopAll stops a running adapter and nothing starts afterwards", async () => {
    const { adapter, supervisor, apply } = setup();
    await apply(linked, true);
    await supervisor.stopAll();
    expect(supervisor.status("twitch").state).toBe("stopped");

    await apply(linked, true);
    expect(adapter.starts).toBe(1);
  });
});
