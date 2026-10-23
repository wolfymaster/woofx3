import { afterEach, describe, expect, test } from "bun:test";
import { RELAY_CONFIG_UPDATED_SUBJECT } from "@woofx3/common/cloudevents/Relay/relay";
import { FakeDispatcherDb } from "../../chat/testing";
import type { EndpointStore } from "../../companion/endpoint-store";
import { MODULE_SETTING_UPDATED_SUBJECT } from "../../companion/route-watch";
import { ChatEnvSchema, chatConfig } from "../../config/chat";
import { GatewayEnvSchema, gatewayConfig } from "../../config/gateway";
import { HostEnvSchema, hostConfig } from "../../config/host";
import { OBS_SERVED_BUDGETS_MS, type ObsConfig, ObsEnvSchema, obsConfig } from "../../config/obs";
import { systemTimers } from "../../host/deps";
import { Host } from "../../host/host";
import type { InstalledModule, LinkState } from "../../host/link-readers";
import {
  bytes,
  countingIds,
  FakeBus,
  FakeTime,
  fixedLinkStore,
  flush,
  halfRandom,
  RecordingLogger,
  shippedLinkReaders,
  testCompanion,
  text,
} from "../../host/testing";
import { ObsAdapter, obsAdapterModule } from "./adapter";
import { OBS_NOT_CONNECTED } from "./control";
import { type FakeObsServer, startFakeObs } from "./fake-obs-server";
import { obsLinkReader } from "./link";
import { RefreshLatch } from "./refresh-latch";

const OVERLAY_PORT = 9101;

const emptyStore: EndpointStore = {
  moduleManifest: async () => null,
  moduleSettings: async () => [],
  moduleSecrets: async () => ({}),
  relayConfig: async () => null,
};

/** The shipped OBS configuration, pointed at `port` on this machine. */
function obsAt(port: number, env: Record<string, unknown> = {}): ObsConfig {
  return obsConfig(ObsEnvSchema.parse({ woofx3ObsPort: port, ...env }));
}

/** A port nothing listens on, as on an engine whose OBS is closed. */
const CLOSED_OBS = obsAt(1);

function newAdapter(config: ObsConfig = CLOSED_OBS, latch = new RefreshLatch()): ObsAdapter {
  return new ObsAdapter({ config, random: halfRandom, timers: systemTimers }, latch);
}

/** The OBS module as barkloader stores it, trimmed to what the link reader reads. */
function obsModule(disabled = false): InstalledModule {
  return {
    moduleId: "woofx3_obs",
    manifest: JSON.stringify({ id: "woofx3_obs", permissions: ["obs.control"] }),
    disabled,
  };
}

const command = (sceneName: string) => bytes(JSON.stringify({ data: { command: "switch_scene", sceneName } }));
const refreshRequest = (bootId: string) => bytes(JSON.stringify({ overlayPort: OVERLAY_PORT, bootId }));
const parsed = (reply: Uint8Array | undefined) => (reply === undefined ? undefined : JSON.parse(text(reply)));

async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("condition not met within 5s");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Long enough for a refresh that is going to happen to have reached the fake OBS. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 150));
}

describe("ObsAdapter manifest", () => {
  const { manifest } = newAdapter();

  test("serves the four OBS subjects with their budgets, the refresh in every state", () => {
    expect(
      manifest.serves.map((served) => [served.subject, served.budgetMs, served.availability ?? "whenRunning"])
    ).toEqual([
      ["engine.obs.command", OBS_SERVED_BUDGETS_MS.command, "whenRunning"],
      ["engine.obs.options", OBS_SERVED_BUDGETS_MS.options, "whenRunning"],
      ["engine.obs.status", OBS_SERVED_BUDGETS_MS.status, "whenRunning"],
      ["engine.obs.browser_source.refresh", OBS_SERVED_BUDGETS_MS.refresh, "always"],
    ]);
  });

  test("holds no relay subjects or credentials of its own: the companion gateway owns them", () => {
    expect(manifest.subscribes).toEqual([]);
    expect(manifest.requests).toEqual([]);
    expect(manifest.publishes).toEqual([]);
  });

  test("claims the OBS module's endpoint, so only it reaches OBS", () => {
    expect(manifest.localEndpoints).toEqual([{ moduleId: "woofx3_obs", endpointId: "obs" }]);
  });

  test("keeps every budget below its callers' timeouts", () => {
    expect(OBS_SERVED_BUDGETS_MS.command).toBeLessThan(5_000);
    expect(OBS_SERVED_BUDGETS_MS.options).toBeLessThan(5_000);
    expect(OBS_SERVED_BUDGETS_MS.status).toBeLessThan(3_000);
    expect(OBS_SERVED_BUDGETS_MS.refresh).toBeLessThan(2_000);
  });
});

describe("ObsAdapter unavailable replies", () => {
  const { manifest } = newAdapter();
  const reply = (subject: string, reason: "stopped" | "parked" | "starting") => {
    const served = manifest.serves.find((s) => s.subject === subject);
    if (served === undefined) {
      throw new Error(`${subject} is not served`);
    }
    return parsed(served.unavailableReply({ reason, link: null }));
  };

  const cases: Array<[subject: string, reason: "stopped" | "parked" | "starting", expected: unknown]> = [
    ["engine.obs.command", "stopped", { ok: false, error: "OBS is turned off in this engine" }],
    ["engine.obs.command", "parked", { ok: false, error: "OBS is turned off in this engine" }],
    ["engine.obs.command", "starting", { ok: false, error: "OBS is starting" }],
    ["engine.obs.options", "stopped", { error: "OBS is turned off in this engine" }],
    ["engine.obs.options", "starting", { error: "OBS is starting" }],
    ["engine.obs.status", "stopped", { state: "stopped", failure: null, address: null }],
    ["engine.obs.status", "starting", { state: "stopped", failure: null, address: null }],
  ];
  for (const [subject, reason, expected] of cases) {
    test(`${subject} while ${reason}`, () => {
      expect(reply(subject, reason)).toEqual(expected);
    });
  }

  test("the refresh request, which only the host's own failure reaches, asks to be retried", () => {
    expect(reply("engine.obs.browser_source.refresh", "stopped")).toEqual({
      status: "unavailable",
      error: "the OBS adapter could not take the request in time",
    });
  });
});

describe("ObsAdapter handlers reached while no run exists", () => {
  const { manifest } = newAdapter();
  const cases: Array<[subject: string, expected: unknown]> = [
    ["engine.obs.command", { ok: false, error: "OBS is turned off in this engine" }],
    ["engine.obs.options", { error: "OBS is turned off in this engine" }],
    ["engine.obs.status", { state: "stopped", failure: null, address: null }],
  ];
  for (const [subject, expected] of cases) {
    test(`${subject} answers as stopped instead of throwing`, async () => {
      const served = manifest.serves.find((s) => s.subject === subject);
      if (served === undefined) {
        throw new Error(`${subject} is not served`);
      }
      const answered = await served.handle(command("main"), {} as Parameters<typeof served.handle>[1]);
      expect(parsed(answered)).toEqual(expected);
    });
  }
});

describe("obsAdapterModule", () => {
  test("builds the refresh latch as host state and hands it to the adapter", () => {
    const module = obsAdapterModule({
      config: CLOSED_OBS,
      random: halfRandom,
      timers: systemTimers,
    });
    const latch = module.hostState?.();
    expect(latch).toBeInstanceOf(RefreshLatch);
    expect(module.create(latch as RefreshLatch)).toBeInstanceOf(ObsAdapter);
  });
});

describe("ObsAdapter desired", () => {
  const adapter = newAdapter();
  const cases: Array<[LinkState, boolean]> = [
    [{ connected: true, enabled: true }, true],
    [{ connected: true, enabled: false }, false],
    [{ connected: false, enabled: true }, false],
  ];
  for (const [link, desired] of cases) {
    test(`${JSON.stringify(link)} -> ${desired}`, () => {
      expect(adapter.desired(link)).toBe(desired);
    });
  }
});

/**
 * The OBS adapter alone under the real host, supervisor and OBS link reader.
 * `modules` is what db-proxy lists as installed, the OBS module (active) to
 * begin with; `setEnabled` switches that module on or off and lets the
 * host's backstop pass apply it.
 */
function hosted(config: ObsConfig = CLOSED_OBS, store = emptyStore, modules: InstalledModule[] = [obsModule()]) {
  const time = new FakeTime();
  const bus = new FakeBus();
  const latch = new RefreshLatch();
  const adapter = newAdapter(config, latch);
  const hostDefaults = hostConfig(HostEnvSchema.parse({}));
  const host = new Host({
    config: hostDefaults,
    gateway: gatewayConfig(GatewayEnvSchema.parse({})),
    companion: testCompanion(store),
    chat: chatConfig(ChatEnvSchema.parse({})),
    dispatcherDb: new FakeDispatcherDb(),
    dbProxy: { baseURL: "http://db.test" },
    bus,
    busConnected: () => true,
    linkStore: fixedLinkStore({}, modules),
    adapters: new Map([["obs", adapter]]),
    hostStates: new Map([["obs", latch]]),
    readers: { ...shippedLinkReaders(), obs: obsLinkReader({ hostExplicit: config.hostExplicit }) },
    clock: time,
    random: halfRandom,
    ids: countingIds(),
    timers: time,
    logger: new RecordingLogger(),
  });
  /** Switches the OBS module on or off; db-proxy announces neither, so it waits for the backstop pass. */
  const setEnabled = async (enabled: boolean) => {
    modules.splice(0, modules.length, obsModule(!enabled));
    await time.advance(hostDefaults.reconcileIntervalMs);
    await host.settled();
  };
  /** Installs or removes the OBS module and announces it as db-proxy does. */
  const setInstalled = async (installed: boolean) => {
    modules.splice(0, modules.length, ...(installed ? [obsModule()] : []));
    bus.deliver(installed ? "db.module.installed.system" : "db.module.deleted.system", bytes("{}"));
    await flush();
    await host.settled();
  };
  const obsState = () => host.snapshot().adapters.find((a) => a.id === "obs")?.status.state;
  /** Delivers a request and waits for its one reply. */
  const ask = async (subject: string, data: Uint8Array) => {
    const replies = bus.deliver(subject, data, "inbox");
    await flush();
    await until(() => replies.length > 0);
    return replies;
  };
  return { adapter, bus, host, setEnabled, setInstalled, obsState, ask };
}

describe("ObsAdapter in the host", () => {
  let running: { host: Host; fake?: FakeObsServer } | undefined;

  afterEach(async () => {
    await running?.host.stop();
    running?.fake?.stop();
    running = undefined;
  });

  test("starts with OBS closed, and a command answers at once that OBS is not connected", async () => {
    const { host, ask } = hosted();
    running = { host };
    await host.start();
    await host.settled();

    expect(host.snapshot().adapters.find((a) => a.id === "obs")?.status.state).toBe("connected");
    const [reply] = await ask("engine.obs.command", command("Raid"));
    expect(parsed(reply)).toEqual({ ok: false, error: OBS_NOT_CONNECTED });
    const [options] = await ask("engine.obs.options", bytes(JSON.stringify({ data: { list: "scenes" } })));
    expect(parsed(options)).toEqual({ error: OBS_NOT_CONNECTED });
  });

  test("answers status from the connection while running, and as stopped once turned off", async () => {
    const { host, ask, setEnabled, adapter } = hosted();
    running = { host };
    await host.start();
    await host.settled();

    const [runningStatus] = await ask("engine.obs.status", bytes("{}"));
    expect(["connecting", "retrying"]).toContain(parsed(runningStatus).state);
    expect(["connecting", "retrying"]).toContain(adapter.detail().state as string);

    await setEnabled(false);
    const [stoppedStatus] = await ask("engine.obs.status", bytes("{}"));
    expect(parsed(stoppedStatus)).toEqual({ state: "stopped", failure: null, address: null });
    const [stoppedCommand] = await ask("engine.obs.command", command("Raid"));
    expect(parsed(stoppedCommand)).toEqual({ ok: false, error: "OBS is turned off in this engine" });
    expect(adapter.detail()).toEqual({ state: "stopped", route: null, address: null });
  });

  test("start, stop, start leaves one handler per subscription", async () => {
    const { host, bus, setEnabled } = hosted();
    running = { host };
    await host.start();
    await host.settled();

    // Only the companion gateway's route watch subscribes to them, once for the life of the host.
    await setEnabled(false);
    expect(bus.active(MODULE_SETTING_UPDATED_SUBJECT)).toBe(1);
    expect(bus.active(RELAY_CONFIG_UPDATED_SUBJECT)).toBe(1);
    await setEnabled(true);

    expect(bus.active(MODULE_SETTING_UPDATED_SUBJECT)).toBe(1);
    expect(bus.active(RELAY_CONFIG_UPDATED_SUBJECT)).toBe(1);
    expect(bus.active("engine.obs.command")).toBe(1);
  });

  test("a command reaches OBS once it is connected", async () => {
    const fake = startFakeObs({
      scenes: [
        { name: "Main", items: [] },
        { name: "Raid", items: [] },
      ],
    });
    const { host, ask, adapter } = hosted(obsAt(fake.port));
    running = { host, fake };
    await host.start();
    await host.settled();
    await until(() => adapter.detail().state === "connected");

    const [reply] = await ask("engine.obs.command", command("Raid"));
    expect(parsed(reply)).toEqual({ ok: true });
    expect(fake.requests).toContain("SetCurrentProgramScene");
  });
});

describe("When the OBS adapter runs", () => {
  let running: { host: Host; fake?: FakeObsServer } | undefined;

  afterEach(async () => {
    await running?.host.stop();
    running?.fake?.stop();
    running = undefined;
  });

  test("with no OBS module and no host set: stopped, never dials, and ctx.obs hears it is turned off", async () => {
    const fake = startFakeObs();
    const { host, ask, obsState } = hosted(obsAt(fake.port), emptyStore, []);
    running = { host, fake };
    await host.start();
    await host.settled();

    expect(obsState()).toBe("stopped");
    const [reply] = await ask("engine.obs.command", command("Raid"));
    expect(parsed(reply)).toEqual({ ok: false, error: "OBS is turned off in this engine" });
    const [status] = await ask("engine.obs.status", bytes("{}"));
    expect(parsed(status)).toEqual({ state: "stopped", failure: null, address: null });
    await settle();
    expect(fake.upgrades).toHaveLength(0);
  });

  test("installing the OBS module starts it at once, and removing it stops it, without a restart", async () => {
    const fake = startFakeObs();
    const { host, adapter, setInstalled, obsState } = hosted(obsAt(fake.port), emptyStore, []);
    running = { host, fake };
    await host.start();
    await host.settled();

    await setInstalled(true);
    expect(obsState()).toBe("connected");
    await until(() => adapter.detail().state === "connected");

    await setInstalled(false);
    expect(obsState()).toBe("stopped");
    expect(adapter.detail()).toEqual({ state: "stopped", route: null, address: null });
  });

  test("switching the OBS module off stops it on the next backstop pass", async () => {
    const { host, setEnabled, obsState } = hosted();
    running = { host };
    await host.start();
    await host.settled();
    expect(obsState()).toBe("connected");

    await setEnabled(false);
    expect(obsState()).toBe("stopped");
  });

  test("WOOFX3_OBS_HOST set keeps it running with no OBS module installed", async () => {
    const fake = startFakeObs();
    const { host, adapter, obsState } = hosted(obsAt(fake.port, { woofx3ObsHost: "127.0.0.1" }), emptyStore, []);
    running = { host, fake };
    await host.start();
    await host.settled();

    expect(obsState()).toBe("connected");
    await until(() => adapter.detail().state === "connected");
  });

  test("an OBS module whose manifest cannot be read does not start it", async () => {
    const { host, obsState } = hosted(CLOSED_OBS, emptyStore, [
      { moduleId: "woofx3_obs", manifest: "{", disabled: false },
    ]);
    running = { host };
    await host.start();
    await host.settled();
    expect(obsState()).toBe("stopped");
  });
});

describe("ObsAdapter reconnects", () => {
  let running: { host: Host; fake: FakeObsServer } | undefined;

  afterEach(async () => {
    await running?.host.stop();
    running?.fake.stop();
    running = undefined;
  });

  const settingEvent = (moduleId: string) =>
    bytes(JSON.stringify({ type: "db.module.setting.updated", data: { moduleId, key: "password" } }));

  async function connected(store: EndpointStore = emptyStore) {
    const fake = startFakeObs();
    const setup = hosted(obsAt(fake.port), store);
    running = { host: setup.host, fake };
    await setup.host.start();
    await setup.host.settled();
    await until(() => setup.adapter.detail().state === "connected");
    return { fake, ...setup };
  }

  test("when the OBS module's settings change", async () => {
    const { fake, bus } = await connected();
    bus.deliver("db.module.setting.updated.woofx3_obs", settingEvent("woofx3_obs"));
    await until(() => fake.upgrades.length === 2);
  });

  test("not when another module's settings change", async () => {
    const { fake, bus } = await connected();
    bus.deliver("db.module.setting.updated.other", settingEvent("other"));
    bus.deliver("db.module.setting.updated.other", bytes("not json"));
    await settle();
    expect(fake.upgrades).toHaveLength(1);
  });

  test("not when a relay configuration change leaves OBS on its route", async () => {
    const { fake, bus } = await connected();
    bus.deliver(RELAY_CONFIG_UPDATED_SUBJECT, bytes("{}"));
    await settle();
    expect(fake.upgrades).toHaveLength(1);
  });

  test("when the relay configuration cannot be read, to be sure", async () => {
    // Only the read the change triggers fails; the reconnect's own read succeeds.
    let failNextRead = false;
    const store: EndpointStore = {
      ...emptyStore,
      relayConfig: async () => {
        if (failNextRead) {
          failNextRead = false;
          throw new Error("db-proxy is down");
        }
        return null;
      },
    };
    const { fake, bus } = await connected(store);
    failNextRead = true;
    bus.deliver(RELAY_CONFIG_UPDATED_SUBJECT, bytes("{}"));
    await until(() => fake.upgrades.length === 2);
  });
});

describe("overlay refresh through the host", () => {
  let running: { host: Host; fake: FakeObsServer } | undefined;

  afterEach(async () => {
    await running?.host.stop();
    running?.fake.stop();
    running = undefined;
  });

  const refreshes = (fake: FakeObsServer) => fake.requests.filter((type) => type === "GetInputList").length;

  function withObs() {
    const fake = startFakeObs();
    const setup = hosted(obsAt(fake.port));
    running = { host: setup.host, fake };
    return { fake, ...setup };
  }

  test("a request while the adapter is stopped is accepted, and refreshes once it starts", async () => {
    const { fake, host, ask, setEnabled } = withObs();
    await host.start();
    await host.settled();
    await setEnabled(false);

    expect((await ask("engine.obs.browser_source.refresh", refreshRequest("boot-1"))).map(parsed)).toEqual([
      { status: "accepted", bootId: "boot-1" },
    ]);
    await settle();
    expect(refreshes(fake)).toBe(0);

    await setEnabled(true);
    await until(() => refreshes(fake) === 1);
  });

  test("connectors starting after sceneManager: unanswered until the host serves, then accepted and refreshed", async () => {
    const { fake, host, ask, bus } = withObs();
    // sceneManager's requester repeats until a reply accepts; before the host
    // runs, nothing answers.
    const unanswered = bus.deliver("engine.obs.browser_source.refresh", refreshRequest("boot-1"), "inbox");
    await flush();
    expect(unanswered).toEqual([]);

    await host.start();
    await host.settled();
    expect((await ask("engine.obs.browser_source.refresh", refreshRequest("boot-1"))).map(parsed)).toEqual([
      { status: "accepted", bootId: "boot-1" },
    ]);
    await until(() => refreshes(fake) === 1);
  });

  test("an adapter restart before the refresh still refreshes once; after it, never again", async () => {
    const { fake, host, ask, setEnabled } = withObs();
    await host.start();
    await host.settled();
    // Stopped straight away, before OBS could be reached for the request.
    await setEnabled(false);
    await ask("engine.obs.browser_source.refresh", refreshRequest("boot-1"));
    await setEnabled(true);
    await setEnabled(false);
    await setEnabled(true);
    await until(() => refreshes(fake) === 1);

    await setEnabled(false);
    await setEnabled(true);
    await ask("engine.obs.browser_source.refresh", refreshRequest("boot-1"));
    await until(() => fake.upgrades.length >= 3);
    await settle();
    expect(refreshes(fake)).toBe(1);
  });

  test("a repeated boot id is accepted again without a second refresh", async () => {
    const { fake, host, ask, adapter } = withObs();
    await host.start();
    await host.settled();
    await until(() => adapter.detail().state === "connected");

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await ask("engine.obs.browser_source.refresh", refreshRequest("boot-1"))).map(parsed)).toEqual([
        { status: "accepted", bootId: "boot-1" },
      ]);
    }
    await until(() => refreshes(fake) === 1);
    await settle();
    expect(refreshes(fake)).toBe(1);
  });

  test("refuses a request that is not a refresh request, and latches nothing", async () => {
    const { fake, host, ask } = withObs();
    await host.start();
    await host.settled();

    const [notJson] = await ask("engine.obs.browser_source.refresh", bytes("nope"));
    expect(parsed(notJson)).toEqual({ status: "invalid", error: "the request is not JSON" });
    const [noBootId] = await ask("engine.obs.browser_source.refresh", bytes(JSON.stringify({ overlayPort: 9101 })));
    expect(parsed(noBootId).status).toBe("invalid");
    await settle();
    expect(refreshes(fake)).toBe(0);
  });
});
