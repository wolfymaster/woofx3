import { describe, expect, test } from "bun:test";
import {
  INTEGRATION_ENABLED_UPDATED_SUBJECT,
  INTEGRATION_TOKEN_UPDATED_SUBJECT,
} from "@woofx3/common/integrations/integration-settings";
import { HostEnvSchema, hostConfig } from "../config/host";
import type { ServedSubject } from "./adapter";
import { Host } from "./host";
import { LINK_READERS, type SettingsReader } from "./link-readers";
import {
  bytes,
  countingIds,
  FakeAdapter,
  FakeBus,
  FakeTime,
  flush,
  halfRandom,
  RecordingLogger,
  text,
} from "./testing";

const twitchapi: ServedSubject = {
  subject: "twitchapi",
  budgetMs: 9_000,
  handle: async () => bytes("ok"),
  unavailableReply: ({ reason, link }) => bytes(link?.connected ? `integration_unavailable:${reason}` : "not_linked"),
};

function event(subject: string, data: Record<string, unknown>): Uint8Array {
  return bytes(JSON.stringify({ specversion: "1.0", id: "e", type: subject, source: "api", data }));
}

async function setup(served: ServedSubject = twitchapi, env: Record<string, unknown> = {}) {
  const values: Record<string, string> = {};
  const settings: SettingsReader = { getSetting: async (key) => values[key] ?? null };
  const bus = new FakeBus();
  const adapter = new FakeAdapter("twitch", [served]);
  const time = new FakeTime();
  const logger = new RecordingLogger();
  const host = new Host({
    config: hostConfig(HostEnvSchema.parse(env)),
    dbProxyUrl: "http://db.test",
    bus,
    busConnected: () => true,
    settings,
    adapters: new Map([["twitch", adapter]]),
    readers: LINK_READERS,
    clock: time,
    random: halfRandom,
    ids: countingIds(),
    timers: time,
    logger,
  });
  const announce = async (enabled: boolean) => {
    bus.deliver(
      INTEGRATION_ENABLED_UPDATED_SUBJECT,
      event(INTEGRATION_ENABLED_UPDATED_SUBJECT, { integration: "twitch", enabled })
    );
    bus.deliver(INTEGRATION_TOKEN_UPDATED_SUBJECT, event(INTEGRATION_TOKEN_UPDATED_SUBJECT, { integration: "twitch" }));
    await flush();
    await host.settled();
  };
  const ask = async () => {
    const replies = bus.deliver("twitchapi", bytes("{}"), "inbox");
    await flush();
    return replies.map(text);
  };
  return { values, bus, adapter, host, time, logger, announce, ask };
}

describe("Host", () => {
  test("starts the adapter on link, stops it on disable and on unlink, without a restart", async () => {
    const { values, adapter, host, announce, ask } = await setup();
    await host.start();
    await host.settled();
    expect(await ask()).toEqual(["not_linked"]);

    values.twitch_token = "tok";
    values["integration.twitch.enabled"] = "true";
    await announce(true);
    expect(adapter.starts).toBe(1);
    expect(await ask()).toEqual(["ok"]);

    values["integration.twitch.enabled"] = "false";
    await announce(false);
    expect(adapter.stops).toBe(1);
    expect(await ask()).toEqual(["integration_unavailable:stopped"]);

    values["integration.twitch.enabled"] = "true";
    await announce(true);
    values.twitch_token = "";
    values["integration.twitch.enabled"] = "false";
    await announce(false);
    expect(adapter.starts).toBe(2);
    expect(await ask()).toEqual(["not_linked"]);
  });

  test("stop stops the adapters and drops every host subscription", async () => {
    const { values, bus, adapter, host } = await setup();
    values.twitch_token = "tok";
    await host.start();
    await host.settled();
    expect(adapter.starts).toBe(1);

    await host.stop();
    expect(adapter.stops).toBe(1);
    expect(bus.subscriptions.filter((s) => s.active)).toHaveLength(0);
  });

  test("stop gives up on a served handler that ignores its deadline once the drain time is spent", async () => {
    const stuck: ServedSubject = { ...twitchapi, handle: () => new Promise<Uint8Array>(() => {}) };
    const { values, bus, host, time, logger } = await setup(stuck);
    values.twitch_token = "tok";
    await host.start();
    await host.settled();
    bus.deliver("twitchapi", bytes("{}"), "inbox");
    await flush();

    let stopped = false;
    void host.stop().then(() => {
      stopped = true;
    });
    await flush();
    // The drain time is the larger of the 10 s stop deadline and the 9 s budget.
    await time.advance(9_999);
    expect(stopped).toBe(false);
    await time.advance(1);
    expect(stopped).toBe(true);
    expect(logger.at("error").some((entry) => entry.message.includes("still running past"))).toBe(true);
  });

  test("refuses a shutdown deadline that does not cover the db-proxy timeout and the longest served budget", async () => {
    const slow: ServedSubject = { ...twitchapi, budgetMs: 14_000 };
    await expect(setup(slow)).rejects.toThrow("must exceed the db-proxy timeout");
    await expect(setup(slow, { woofx3ConnectorsShutdownDeadlineMs: 16_001 })).resolves.toBeDefined();
  });

  test("refuses a second start", async () => {
    const { host } = await setup();
    await host.start();
    await expect(host.start()).rejects.toThrow("already running");
  });
});
