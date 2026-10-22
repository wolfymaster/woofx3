import { describe, expect, test } from "bun:test";
import { type EgressActionId, PLATFORM_GATEWAY_SUBJECTS, type PlatformId } from "@woofx3/api/platform-gateway";
import type { AdapterManifest, AdapterStatus, EgressHandlers } from "../host/adapter";
import type { AdapterId } from "../host/adapter-ids";
import { HostRequests } from "../host/host-requests";
import type { LinkState } from "../host/link-readers";
import { ScopeCounters, ScopedBus } from "../host/scoped-bus";
import {
  bytes,
  countingIds,
  disabled,
  FakeBus,
  FakeTime,
  flush,
  linked,
  RecordingLogger,
  text,
  unlinked,
} from "../host/testing";
import {
  type CapabilitiesReply,
  type DiscoveryAdapters,
  type FieldOption,
  type FieldOptionsReply,
  GATEWAY_CAPABILITIES_RESULT_TYPE,
  GATEWAY_FIELD_OPTIONS_RESULT_TYPE,
  GatewayDiscovery,
  type PlatformCapability,
} from "./discovery";
import { EgressRegistry } from "./egress-registry";

const CAPABILITIES = PLATFORM_GATEWAY_SUBJECTS.capabilities;
const FIELD_OPTIONS = PLATFORM_GATEWAY_SUBJECTS.fieldOptions;

// The contract has one platform; a second, test-only id shows filtering across two.
const KICK = "kick" as PlatformId;
const CATALOG: readonly PlatformId[] = ["twitch", KICK];

class FakePlatforms implements DiscoveryAdapters {
  private readonly statuses = new Map<string, AdapterStatus>();
  private readonly links = new Map<string, LinkState>();

  status(id: AdapterId): AdapterStatus {
    return this.statuses.get(id) ?? { state: "stopped" };
  }

  link(id: AdapterId): LinkState | null {
    return this.links.get(id) ?? null;
  }

  set(id: string, link: LinkState, status: AdapterStatus): void {
    this.links.set(id, link);
    this.statuses.set(id, status);
  }
}

const handler = { handle: async () => ({ status: "delivered" as const }) };

function manifest(id: string, egress: EgressHandlers): AdapterManifest {
  return { id: id as AdapterId, publishes: [], subscribes: [], requests: [], serves: [], egress };
}

async function setup() {
  const time = new FakeTime();
  const bus = new FakeBus();
  const logger = new RecordingLogger();
  const scope = new ScopedBus({
    scope: "host",
    client: bus,
    grants: { publishes: [], subscribes: [CAPABILITIES, FIELD_OPTIONS], requests: [] },
    limits: { concurrency: 16, queueCap: 16 },
    logger,
    counters: new ScopeCounters(),
    clock: time,
  });
  const platforms = new FakePlatforms();
  const discovery = new GatewayDiscovery({
    egress: EgressRegistry.fromManifests(
      [
        manifest("twitch", { "chat.send": handler, "chat.announce": handler, "chat.pin": handler }),
        manifest(KICK, { "chat.send": handler }),
      ],
      CATALOG
    ),
    adapters: platforms,
    requests: new HostRequests({ clock: time, ids: countingIds(), timers: time, logger }),
  });
  await discovery.serve(scope);

  const ask = async <T>(subject: string, body: string, type: string): Promise<T> => {
    const replies = bus.deliver(subject, bytes(body), "inbox");
    await flush();
    expect(replies).toHaveLength(1);
    const event = JSON.parse(text(replies[0] as Uint8Array)) as { type: string; data: T };
    expect(event.type).toBe(type);
    return event.data;
  };
  return {
    platforms,
    discovery,
    capabilities: () => ask<CapabilitiesReply>(CAPABILITIES, "{}", GATEWAY_CAPABILITIES_RESULT_TYPE),
    options: (body: unknown) =>
      ask<FieldOptionsReply>(
        FIELD_OPTIONS,
        typeof body === "string" ? body : JSON.stringify(body),
        GATEWAY_FIELD_OPTIONS_RESULT_TYPE
      ),
  };
}

const running: AdapterStatus = { state: "connected", since: 0 };

describe("platform.gateway.capabilities", () => {
  test("reports each platform's state, link and supported actions", async () => {
    const { platforms, capabilities } = await setup();
    platforms.set("twitch", linked, running);
    platforms.set(KICK, disabled, { state: "stopped" });

    const reply = (await capabilities()) as { platforms: PlatformCapability[] };
    expect(reply.platforms).toHaveLength(2);
    expect(reply.platforms[0]).toEqual({
      id: "twitch",
      displayName: "Twitch",
      state: "connected",
      connected: true,
      enabled: true,
      actions: ["chat.send", "chat.announce", "chat.pin"],
    });
    // The test-only platform has no display name in the contract.
    expect(reply.platforms[1]).toMatchObject({
      id: KICK,
      state: "stopped",
      connected: true,
      enabled: false,
      actions: ["chat.send"],
    });
  });

  test("a platform whose link has not been read is neither connected nor enabled", async () => {
    const { capabilities } = await setup();
    const reply = (await capabilities()) as {
      platforms: Array<{ state: string; connected: boolean; enabled: boolean }>;
    };
    expect(reply.platforms[0]).toMatchObject({ state: "stopped", connected: false, enabled: false });
  });
});

describe("platform.gateway.field_options", () => {
  test.each<[EgressActionId, PlatformId[]]>([
    ["chat.send", ["twitch", KICK]],
    ["chat.announce", ["twitch"]],
    ["chat.pin", ["twitch"]],
  ])("%s lists only the platforms that can perform it", async (action, expected) => {
    const { platforms, options } = await setup();
    platforms.set("twitch", linked, running);
    platforms.set(KICK, linked, running);

    const reply = await options({ action });
    expect(Array.isArray(reply)).toBe(true);
    expect((reply as FieldOption[]).map((option) => option.value)).toEqual(expected);
  });

  test("labels an option with the platform's display name", async () => {
    const { platforms, options } = await setup();
    platforms.set("twitch", linked, running);

    // The shape the UI's parseFieldOptionsReply reads: strings for value and label.
    expect(await options({ action: "chat.announce" })).toEqual([{ value: "twitch", label: "Twitch" }]);
  });

  test.each([
    ["unlinked", unlinked],
    ["disabled", disabled],
  ])("hides a platform that is %s", async (_name, link) => {
    const { platforms, options } = await setup();
    platforms.set("twitch", link, { state: "stopped" });

    expect(await options({ action: "chat.send" })).toEqual([]);
  });

  test("hides a platform whose link was never read", async () => {
    const { options } = await setup();
    expect(await options({ action: "chat.send" })).toEqual([]);
  });

  test("an unknown action is an error, not an empty list", async () => {
    const { options } = await setup();
    expect(await options({ action: "chat.shout" })).toEqual({ error: 'unknown action "chat.shout"' });
  });

  test.each([
    ["not JSON", "{"],
    ["no action", "{}"],
    ["an empty action", '{"action":""}'],
    ["a non-string action", '{"action":3}'],
    ["a non-object body", "[]"],
  ])("a request that is %s is an error", async (_name, body) => {
    const { options } = await setup();
    const reply = await options(body);
    expect(Array.isArray(reply)).toBe(false);
    expect(typeof (reply as { error: string }).error).toBe("string");
  });

  test("reads the action from a CloudEvent envelope, as the api relays a module field's request", async () => {
    const { platforms, options } = await setup();
    platforms.set("twitch", linked, running);

    expect(await options({ id: "e-1", type: "x", data: { action: "chat.pin" } })).toEqual([
      { value: "twitch", label: "Twitch" },
    ]);
  });
});
