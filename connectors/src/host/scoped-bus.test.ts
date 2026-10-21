import { describe, expect, test } from "bun:test";
import { ScopeCounters, ScopedBus, ScopedBusRefusal, type SubjectGrants, subjectCovered } from "./scoped-bus";
import { bytes, FakeBus, flush, RecordingLogger } from "./testing";

const grants: SubjectGrants = {
  publishes: ["twitch.events.>"],
  subscribes: ["setting.integration.*.updated", "twitchapi"],
  requests: ["engine.twitch.token"],
};

function setup(limits = { concurrency: 2, queueCap: 1 }) {
  const client = new FakeBus();
  const logger = new RecordingLogger();
  const counters = new ScopeCounters();
  const errors: string[] = [];
  const bus = new ScopedBus({
    scope: "twitch",
    client,
    grants,
    limits,
    logger,
    counters,
    onHandlerError: (subject) => errors.push(subject),
  });
  return { client, logger, counters, bus, errors };
}

describe("subjectCovered", () => {
  const cases: Array<[pattern: string, subject: string, covered: boolean]> = [
    ["twitchapi", "twitchapi", true],
    ["twitchapi", "twitchapi.extra", false],
    ["a.*.c", "a.b.c", true],
    ["a.*.c", "a.b.d", false],
    ["a.*", "a", false],
    ["a.>", "a.b.c", true],
    ["a.>", "a", false],
    ["a.>", "a.*", true],
    ["a.*", "a.>", false],
    ["a.b", "a.*", false],
  ];
  for (const [pattern, subject, covered] of cases) {
    test(`${pattern} ${covered ? "covers" : "does not cover"} ${subject}`, () => {
      expect(subjectCovered(pattern, subject)).toBe(covered);
    });
  }
});

describe("ScopedBus", () => {
  test("refuses every operation on a subject the manifest does not declare, naming adapter and subject", async () => {
    const { bus, client, counters } = setup();
    const refusals: Array<() => Promise<unknown>> = [
      () => bus.publish("chat.message.send", bytes("{}")),
      () => bus.subscribe("engine.obs.command", () => {}),
      () => bus.request("db.anything", bytes("{}"), { timeout: 100 }),
    ];
    for (const attempt of refusals) {
      await expect(attempt()).rejects.toBeInstanceOf(ScopedBusRefusal);
    }
    await expect(bus.publish("chat.message.send", bytes("{}"))).rejects.toThrow(
      'twitch may not publish on "chat.message.send"'
    );
    expect(counters.refusals).toBe(4);
    expect(client.published).toEqual([]);
  });

  test("allows declared subjects, including through wildcards", async () => {
    const { bus, client } = setup();
    await bus.publish("twitch.events.follow", bytes("{}"));
    await bus.subscribe("setting.integration.token.updated", () => {});
    expect(client.published.map((p) => p.subject)).toEqual(["twitch.events.follow"]);
    expect(client.active("setting.integration.token.updated")).toBe(1);
  });

  test("a throwing handler is counted and reported, and the subscription keeps delivering", async () => {
    const { bus, client, counters, errors, logger } = setup();
    let calls = 0;
    await bus.subscribe("twitchapi", () => {
      calls++;
      if (calls === 1) {
        throw new Error("boom");
      }
    });
    client.deliver("twitchapi", bytes("1"));
    client.deliver("twitchapi", bytes("2"));
    await flush();

    expect(calls).toBe(2);
    expect(counters.snapshot().subscriptions.twitchapi).toEqual({
      received: 2,
      handled: 1,
      handlerErrors: 1,
      dropped: 0,
    });
    expect(errors).toEqual(["twitchapi"]);
    expect(logger.at("error")[0].metadata).toMatchObject({ scope: "twitch", subject: "twitchapi", error: "boom" });
  });

  test("runs at most `concurrency` handlers, queues up to `queueCap` and drops the rest", async () => {
    const { bus, client, counters, logger } = setup({ concurrency: 2, queueCap: 1 });
    const releases: Array<() => void> = [];
    let started = 0;
    await bus.subscribe("twitchapi", () => {
      started++;
      return new Promise<void>((resolve) => releases.push(resolve));
    });

    for (let i = 0; i < 5; i++) {
      client.deliver("twitchapi", bytes(String(i)));
    }
    await flush();
    expect(started).toBe(2);
    expect(counters.snapshot().subscriptions.twitchapi.dropped).toBe(2);
    expect(logger.at("warn")).toHaveLength(1);

    releases.shift()?.();
    await flush();
    expect(started).toBe(3);
  });

  test("closeAll unsubscribes, waits for running handlers and refuses use afterwards", async () => {
    const { bus, client } = setup();
    let release: (() => void) | undefined;
    let finished = false;
    await bus.subscribe("twitchapi", async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      finished = true;
    });
    client.deliver("twitchapi", bytes("held"));
    await flush();

    const closing = bus.closeAll();
    expect(client.active("twitchapi")).toBe(0);
    release?.();
    await closing;
    expect(finished).toBe(true);
    await expect(bus.publish("twitch.events.follow", bytes("{}"))).rejects.toThrow("closed");
  });

  test("closeAll closes every subscription and then reports the ones that failed", async () => {
    const { bus, client } = setup();
    await bus.subscribe("twitchapi", () => {});
    await bus.subscribe("setting.integration.token.updated", () => {});
    client.failUnsubscribe = true;

    await expect(bus.closeAll()).rejects.toThrow("2 subscription(s) failed to close");
  });
});
