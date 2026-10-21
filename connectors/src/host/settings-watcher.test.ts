import { describe, expect, test } from "bun:test";
import {
  INTEGRATION_ENABLED_UPDATED_SUBJECT,
  INTEGRATION_TOKEN_UPDATED_SUBJECT,
} from "@woofx3/common/integrations/integration-settings";
import type { AdapterId } from "./adapter-ids";
import { LINK_READERS, type LinkState, type SettingsReader } from "./link-readers";
import { ScopeCounters, ScopedBus } from "./scoped-bus";
import { type LinkSink, SETTINGS_SUBJECTS, SettingsWatcher } from "./settings-watcher";
import { bytes, FakeBus, FakeTime, flush, RecordingLogger } from "./testing";

interface Applied {
  links: Record<string, LinkState>;
  changed: AdapterId[];
}

class FakeSettings implements SettingsReader {
  values: Record<string, string> = {};
  reads = 0;
  failing = false;
  gate: Promise<void> | undefined;

  async getSetting(key: string): Promise<string | null> {
    this.reads++;
    await this.gate;
    if (this.failing) {
      throw new Error("db-proxy is down");
    }
    return this.values[key] ?? null;
  }
}

function cloudEvent(subject: string, data: unknown): Uint8Array {
  return bytes(JSON.stringify({ specversion: "1.0", id: "e1", type: subject, source: "api", data }));
}

async function setup() {
  const time = new FakeTime();
  const bus = new FakeBus();
  const logger = new RecordingLogger();
  const settings = new FakeSettings();
  settings.values = { twitch_token: "tok", "integration.twitch.enabled": "true" };
  const applied: Applied[] = [];
  const sink: LinkSink = {
    reconcile: async (links, changed) => {
      applied.push({ links: Object.fromEntries(links), changed: [...changed] });
    },
  };
  const scope = new ScopedBus({
    scope: "host",
    client: bus,
    grants: { publishes: [], subscribes: [...SETTINGS_SUBJECTS], requests: [] },
    limits: { concurrency: 4, queueCap: 8 },
    logger,
    counters: new ScopeCounters(),
  });
  const watcher = new SettingsWatcher({
    adapters: ["twitch"],
    readers: LINK_READERS,
    settings,
    sink,
    scope,
    clock: time,
    timers: time,
    logger,
    reconcileIntervalMs: 60_000,
  });
  return { time, bus, logger, settings, applied, watcher };
}

describe("SettingsWatcher", () => {
  test("reads every link at start and on the backstop interval, naming no adapter as changed", async () => {
    const { time, applied, watcher } = await setup();
    await watcher.start();
    expect(applied).toEqual([{ links: { twitch: { connected: true, enabled: true } }, changed: [] }]);
    expect(watcher.lastPass).toBe(time.now());

    await time.advance(60_000);
    expect(applied).toHaveLength(2);
    expect(applied[1].changed).toEqual([]);
  });

  test("a settings event for an integration re-reads its adapters and names them changed", async () => {
    const { bus, settings, applied, watcher } = await setup();
    await watcher.start();
    settings.values["integration.twitch.enabled"] = "false";

    bus.deliver(
      INTEGRATION_ENABLED_UPDATED_SUBJECT,
      cloudEvent(INTEGRATION_ENABLED_UPDATED_SUBJECT, { integration: "twitch", enabled: false })
    );
    await flush();
    await watcher.idle();
    expect(applied.at(-1)).toEqual({ links: { twitch: { connected: true, enabled: false } }, changed: ["twitch"] });

    bus.deliver(
      INTEGRATION_TOKEN_UPDATED_SUBJECT,
      cloudEvent(INTEGRATION_TOKEN_UPDATED_SUBJECT, { integration: "twitch" })
    );
    await flush();
    await watcher.idle();
    expect(applied).toHaveLength(3);
  });

  test("an event that names no known integration is ignored with a warning", async () => {
    const { bus, logger, applied, watcher } = await setup();
    await watcher.start();
    const bodies = [
      bytes("not json"),
      bytes(JSON.stringify({ integration: "twitch" })),
      cloudEvent(INTEGRATION_TOKEN_UPDATED_SUBJECT, { integration: "kick" }),
    ];
    for (const body of bodies) {
      bus.deliver(INTEGRATION_TOKEN_UPDATED_SUBJECT, body);
    }
    await flush();
    expect(applied).toHaveLength(1);
    expect(logger.at("warn")).toHaveLength(3);
  });

  test("a failed read keeps the last link state and warns", async () => {
    const { time, settings, logger, applied, watcher } = await setup();
    await watcher.start();
    settings.failing = true;
    await time.advance(60_000);

    expect(applied).toHaveLength(1);
    expect(logger.at("warn").some((entry) => entry.message.includes("keeping the last one"))).toBe(true);
  });

  test("an absent flag is logged once at info, an invalid one once per value at warn", async () => {
    const { time, settings, logger, watcher } = await setup();
    delete settings.values["integration.twitch.enabled"];
    await watcher.start();
    await time.advance(60_000);
    expect(logger.at("info").filter((entry) => entry.message.includes("no enabled setting"))).toHaveLength(1);

    settings.values["integration.twitch.enabled"] = "yes";
    await time.advance(60_000);
    await time.advance(60_000);
    settings.values["integration.twitch.enabled"] = "nope";
    await time.advance(60_000);
    const invalid = logger.at("warn").filter((entry) => entry.message.includes("neither true nor false"));
    expect(invalid.map((entry) => entry.metadata?.value)).toEqual(["yes", "nope"]);
  });

  test("events arriving during a read merge into one follow-up pass", async () => {
    const { bus, settings, applied, watcher } = await setup();
    await watcher.start();
    let open: () => void = () => {};
    settings.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const event = cloudEvent(INTEGRATION_TOKEN_UPDATED_SUBJECT, { integration: "twitch" });

    bus.deliver(INTEGRATION_TOKEN_UPDATED_SUBJECT, event);
    await flush();
    bus.deliver(INTEGRATION_TOKEN_UPDATED_SUBJECT, event);
    bus.deliver(INTEGRATION_TOKEN_UPDATED_SUBJECT, event);
    await flush();
    settings.gate = undefined;
    open();
    await watcher.idle();

    // The start pass, the pass in flight, and one merged pass for the two later events.
    expect(applied).toHaveLength(3);
  });

  test("stop cancels the backstop", async () => {
    const { time, applied, watcher } = await setup();
    await watcher.start();
    await watcher.stop();
    await time.advance(600_000);
    expect(applied).toHaveLength(1);
  });
});
