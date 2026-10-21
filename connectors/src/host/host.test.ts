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

async function setup() {
  const values: Record<string, string> = {};
  const settings: SettingsReader = { getSetting: async (key) => values[key] ?? null };
  const bus = new FakeBus();
  const adapter = new FakeAdapter("twitch", [twitchapi]);
  const time = new FakeTime();
  const host = new Host({
    config: hostConfig(HostEnvSchema.parse({})),
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
    logger: new RecordingLogger(),
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
  return { values, bus, adapter, host, announce, ask };
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

  test("refuses a second start", async () => {
    const { host } = await setup();
    await host.start();
    await expect(host.start()).rejects.toThrow("already running");
  });
});
