import { describe, expect, test } from "bun:test";
import { PLATFORM_IDS, type PlatformId } from "@woofx3/api/platform-gateway";
import type { AdapterManifest, EgressHandlerSpec, EgressHandlers } from "../host/adapter";
import type { AdapterId } from "../host/adapter-ids";
import { EgressRegistry } from "./egress-registry";

const send: EgressHandlerSpec<"chat.send"> = { handle: async () => ({ status: "delivered" }) };

// Ids outside the contract's catalog stand in for a local adapter (not a
// platform) and for a second platform.
const OBS = "obs" as AdapterId;
const KICK = "kick" as PlatformId;

function manifest(id: string, egress?: EgressHandlers): AdapterManifest {
  return { id: id as AdapterId, publishes: [], subscribes: [], requests: [], serves: [], egress };
}

describe("EgressRegistry", () => {
  test("keys handlers by platform and action", () => {
    const registry = EgressRegistry.fromManifests(
      [manifest("twitch", { "chat.send": send }), manifest(KICK, {})],
      ["twitch", KICK]
    );
    expect(registry.platforms).toEqual(["twitch", KICK]);
    expect(registry.supports("twitch", "chat.send")).toBe(true);
    expect(registry.handler("twitch", "chat.send")).toBe(send);
    expect(registry.supports("twitch", "chat.pin")).toBe(false);
    expect(registry.supports(KICK, "chat.send")).toBe(false);
  });

  test("a platform adapter without egress is loaded but supports nothing", () => {
    const registry = EgressRegistry.fromManifests([manifest("twitch")], PLATFORM_IDS);
    expect(registry.platforms).toEqual(["twitch"]);
    expect(registry.supports("twitch", "chat.send")).toBe(false);
  });

  test("an adapter that is not a platform is left out", () => {
    const registry = EgressRegistry.fromManifests([manifest(OBS)], PLATFORM_IDS);
    expect(registry.platforms).toEqual([]);
  });

  const refusals: Array<[name: string, manifests: AdapterManifest[], message: string]> = [
    ["egress on an adapter that is not a platform", [manifest(OBS, { "chat.send": send })], "is not a platform"],
    [
      "an unknown action",
      [manifest("twitch", { "chat.shout": send } as unknown as EgressHandlers)],
      'unknown action "chat.shout"',
    ],
    [
      "a handler without handle",
      [manifest("twitch", { "chat.send": {} } as unknown as EgressHandlers)],
      "has no handle function",
    ],
    [
      "a (platform, action) registered twice",
      [manifest("twitch", { "chat.send": send }), manifest("twitch", { "chat.send": send })],
      'egress for "chat.send" on "twitch" is registered twice',
    ],
  ];
  for (const [name, manifests, message] of refusals) {
    test(`refuses ${name}`, () => {
      expect(() => EgressRegistry.fromManifests(manifests, PLATFORM_IDS)).toThrow(message);
    });
  }
});
