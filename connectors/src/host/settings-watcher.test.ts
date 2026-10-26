import { describe, expect, test } from "bun:test";
import {
  INTEGRATION_ENABLED_UPDATED_SUBJECT,
  INTEGRATION_TOKEN_UPDATED_SUBJECT,
} from "@woofx3/common/integrations/integration-settings";
import { MODULE_DELETED_SUBJECT, MODULE_INSTALLED_SUBJECT } from "../adapters/obs/link";
import type { AdapterId } from "./adapter-ids";
import type { InstalledModule, LinkReaderRegistry, LinkState, LinkStore } from "./link-readers";
import { ScopeCounters, ScopedBus } from "./scoped-bus";
import { type LinkSink, SETTINGS_SUBJECTS, SettingsWatcher, watchedSubjects } from "./settings-watcher";
import { bytes, FakeBus, FakeTime, flush, RecordingLogger, shippedLinkReaders } from "./testing";

const READ_TIMEOUT_MS = 2_000;

interface Applied {
  links: Record<string, LinkState>;
  changed: AdapterId[];
}

class FakeSettings implements LinkStore {
  values: Record<string, string> = {};
  modules: InstalledModule[] = [];
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

  async installedModules(): Promise<InstalledModule[]> {
    this.reads++;
    await this.gate;
    if (this.failing) {
      throw new Error("db-proxy is down");
    }
    return this.modules;
  }
}

const OBS_MODULE: InstalledModule = {
  moduleId: "woofx3_obs",
  manifest: JSON.stringify({ id: "woofx3_obs", permissions: ["obs.control"] }),
  disabled: false,
};

function cloudEvent(subject: string, data: unknown): Uint8Array {
  return bytes(JSON.stringify({ specversion: "1.0", id: "e1", type: subject, source: "api", data }));
}

async function setup(failingSink = false, adapters: AdapterId[] = ["twitch"]) {
  const time = new FakeTime();
  const bus = new FakeBus();
  const logger = new RecordingLogger();
  const settings = new FakeSettings();
  settings.values = { twitch_token: "tok", "integration.twitch.enabled": "true" };
  const readers = shippedLinkReaders();
  const applied: Applied[] = [];
  const sink: LinkSink = {
    reconcile: async (links, changed) => {
      if (failingSink) {
        throw new Error("supervisor exploded");
      }
      applied.push({ links: Object.fromEntries(links), changed: [...changed] });
    },
  };
  const scope = new ScopedBus({
    scope: "host",
    client: bus,
    grants: { publishes: [], subscribes: watchedSubjects(readers), requests: [] },
    limits: { concurrency: 4, queueCap: 8 },
    logger,
    counters: new ScopeCounters(),
    clock: time,
  });
  const watcher = new SettingsWatcher({
    adapters,
    readers,
    store: settings,
    sink,
    scope,
    clock: time,
    timers: time,
    logger,
    reconcileIntervalMs: 60_000,
    readTimeoutMs: READ_TIMEOUT_MS,
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

  test("counts passes in a row in which every read failed, and resets on a read that succeeds", async () => {
    const { time, settings, watcher } = await setup();
    await watcher.start();
    expect(watcher.consecutiveFailedPasses).toBe(0);

    settings.failing = true;
    await time.advance(60_000);
    await time.advance(60_000);
    expect(watcher.consecutiveFailedPasses).toBe(2);
    expect(watcher.lastPass).toBe(time.now());

    settings.failing = false;
    await time.advance(60_000);
    expect(watcher.consecutiveFailedPasses).toBe(0);
  });

  test("a timed-out read counts as a failed pass", async () => {
    const { time, settings, watcher } = await setup();
    await watcher.start();
    settings.gate = new Promise<void>(() => {});
    await time.advance(60_000);
    await time.advance(READ_TIMEOUT_MS);
    expect(watcher.consecutiveFailedPasses).toBe(1);
    settings.gate = undefined;
  });

  test("a read that never answers times out, keeps the last state, and does not stall later passes or stop", async () => {
    const { time, settings, logger, applied, watcher } = await setup();
    await watcher.start();
    settings.gate = new Promise<void>(() => {});

    await time.advance(60_000);
    expect(applied).toHaveLength(1);
    await time.advance(READ_TIMEOUT_MS);
    expect(logger.at("warn").some((entry) => entry.message.includes("timed out"))).toBe(true);
    const passAfterTimeout = watcher.lastPass;
    expect(passAfterTimeout).toBe(time.now());

    settings.gate = undefined;
    await time.advance(60_000);
    expect(applied).toHaveLength(2);

    settings.gate = new Promise<void>(() => {});
    await time.advance(60_000);
    const stopping = watcher.stop();
    await time.advance(READ_TIMEOUT_MS);
    await stopping;
  });

  test("a reconcile that fails is logged and the next pass still runs", async () => {
    const { time, settings, logger, watcher } = await setup(true);
    await watcher.start();
    await flush();
    expect(logger.at("error").some((entry) => entry.message.includes("reconcile failed"))).toBe(true);

    const reads = settings.reads;
    await time.advance(60_000);
    expect(settings.reads).toBeGreaterThan(reads);
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

  test("a module install or removal re-reads OBS and names it changed, whatever the event body", async () => {
    const { bus, settings, applied, watcher } = await setup(false, ["twitch", "obs"]);
    await watcher.start();
    expect(applied[0].links.obs).toEqual({ connected: false, enabled: false });

    settings.modules = [OBS_MODULE];
    bus.deliver("db.module.installed.system", bytes("{}"));
    await flush();
    await watcher.idle();
    expect(applied.at(-1)).toEqual({ links: { obs: { connected: true, enabled: true } }, changed: ["obs"] });

    settings.modules = [];
    bus.deliver("db.module.deleted.system", bytes("not json"));
    await flush();
    await watcher.idle();
    expect(applied.at(-1)).toEqual({ links: { obs: { connected: false, enabled: false } }, changed: ["obs"] });
  });

  test("a module switched off is picked up by the backstop pass, which names nothing changed", async () => {
    const { time, settings, applied, watcher } = await setup(false, ["obs"]);
    settings.modules = [OBS_MODULE];
    await watcher.start();
    settings.modules = [{ ...OBS_MODULE, disabled: true }];

    await time.advance(60_000);
    expect(applied.at(-1)).toEqual({ links: { obs: { connected: true, enabled: false } }, changed: [] });
  });

  test("an ignored record is logged once while it stays, and again once it comes back", async () => {
    const { time, settings, logger, watcher } = await setup(false, ["obs"]);
    const broken: InstalledModule = { moduleId: "broken", manifest: "{", disabled: false };
    settings.modules = [broken];
    await watcher.start();
    await time.advance(60_000);
    await time.advance(60_000);
    settings.modules = [];
    await time.advance(60_000);
    settings.modules = [broken];
    await time.advance(60_000);

    const ignored = logger.at("warn").filter((entry) => entry.message === "link read ignored a stored record");
    expect(ignored).toHaveLength(2);
    expect(ignored[0].metadata).toMatchObject({ adapter: "obs" });
  });

  test("stop cancels the backstop", async () => {
    const { time, applied, watcher } = await setup();
    await watcher.start();
    await watcher.stop();
    await time.advance(600_000);
    expect(applied).toHaveLength(1);
  });
});

describe("watchedSubjects", () => {
  test("lists the settings events, then each reader's own events once", () => {
    expect(watchedSubjects(shippedLinkReaders())).toEqual([
      ...SETTINGS_SUBJECTS,
      MODULE_INSTALLED_SUBJECT,
      MODULE_DELETED_SUBJECT,
    ]);
  });

  test("refuses a reader that lists a settings event among its own events", () => {
    const readers: LinkReaderRegistry = {
      ...shippedLinkReaders(),
      obs: {
        watches: [],
        events: [INTEGRATION_TOKEN_UPDATED_SUBJECT],
        read: async () => ({ connected: true, enabled: true, flag: null, ignored: [] }),
      },
    };
    expect(() => watchedSubjects(readers)).toThrow("name its integration in watches");
  });
});
