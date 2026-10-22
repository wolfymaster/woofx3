import { describe, expect, test } from "bun:test";
import type { EgressActionId, GatewayRequest, PlatformId, Target } from "@woofx3/api/platform-gateway";
import type { LinkState } from "../host/link-readers";
import { disabled, linked, unlinked } from "../host/testing";
import { resolveTarget, type TargetResolution, type TargetView, withOriginReply } from "./targets";

// The contract has one platform; test-only ids give the resolver several to choose from.
const KICK = "kick" as PlatformId;
const YOUTUBE = "youtube" as PlatformId;
const UNLOADED = "unloaded" as PlatformId;

/** All three are linked unless `links` says otherwise; twitch and kick can send, youtube cannot. */
function view(links: Partial<Record<string, LinkState>> = {}): TargetView {
  const all: Record<string, LinkState | null> = { twitch: linked, kick: linked, youtube: linked, ...links };
  return {
    platforms: ["twitch", KICK, YOUTUBE],
    supports: (platform, action) => action === "chat.send" && platform !== YOUTUBE,
    link: (platform) => all[platform] ?? null,
  };
}

describe("resolveTarget", () => {
  const rows: Array<
    [name: string, target: Target, links: Partial<Record<string, LinkState>>, expected: TargetResolution]
  > = [
    [
      "all: every linked, enabled platform; the ones without the action are unsupported",
      { kind: "all" },
      {},
      { ok: true, deliver: ["twitch", KICK], unsupported: [YOUTUBE] },
    ],
    [
      "all: unlinked and disabled platforms are left out",
      { kind: "all" },
      { twitch: unlinked, kick: disabled },
      { ok: true, deliver: [], unsupported: [YOUTUBE] },
    ],
    [
      "platforms: exactly the named ones, whatever their link",
      { kind: "platforms", ids: [KICK, "twitch"] },
      { twitch: unlinked },
      { ok: true, deliver: [KICK, "twitch"], unsupported: [] },
    ],
    [
      "platforms: one without the action is refused",
      { kind: "platforms", ids: ["twitch", YOUTUBE] },
      {},
      { ok: false, problem: 'target.ids[1]: "youtube" cannot perform chat.send' },
    ],
    [
      "platforms: one with no adapter loaded is refused",
      { kind: "platforms", ids: [UNLOADED] },
      {},
      { ok: false, problem: 'target.ids[0]: "unloaded" cannot perform chat.send' },
    ],
    [
      "platforms: a duplicate is refused",
      { kind: "platforms", ids: ["twitch", "twitch"] },
      {},
      { ok: false, problem: 'target.ids[1] names "twitch" twice' },
    ],
    [
      "origin: the event's platform",
      { kind: "origin", origin: { platform: KICK, messageId: "m" } },
      {},
      { ok: true, deliver: [KICK], unsupported: [] },
    ],
    [
      "origin: a platform without the action is unsupported",
      { kind: "origin", origin: { platform: YOUTUBE } },
      {},
      { ok: true, deliver: [], unsupported: [YOUTUBE] },
    ],
    [
      "origin: a platform with no adapter loaded is unsupported",
      { kind: "origin", origin: { platform: UNLOADED } },
      {},
      { ok: true, deliver: [], unsupported: [UNLOADED] },
    ],
  ];
  for (const [name, target, links, expected] of rows) {
    test(name, () => {
      expect(resolveTarget(target, "chat.send" satisfies EgressActionId, view(links))).toEqual(expected);
    });
  }

  test("all with no platform read yet delivers nowhere", () => {
    const empty: TargetView = { platforms: ["twitch"], supports: () => true, link: () => null };
    expect(resolveTarget({ kind: "all" }, "chat.send", empty)).toEqual({ ok: true, deliver: [], unsupported: [] });
  });
});

describe("withOriginReply", () => {
  const base = { idempotencyKey: "k", requestedBy: { kind: "workflow", ref: "w" } } as const;
  const rows: Array<[name: string, request: GatewayRequest, payload: GatewayRequest["payload"]]> = [
    [
      "chat.send on an origin replies to its message",
      {
        ...base,
        action: "chat.send",
        target: { kind: "origin", origin: { platform: "twitch", messageId: "m-1" } },
        payload: { message: "hi" },
      },
      { message: "hi", replyToMessageId: "m-1" },
    ],
    [
      "a payload naming its own reply keeps it",
      {
        ...base,
        action: "chat.send",
        target: { kind: "origin", origin: { platform: "twitch", messageId: "m-1" } },
        payload: { message: "hi", replyToMessageId: "m-0" },
      },
      { message: "hi", replyToMessageId: "m-0" },
    ],
    [
      "an origin without a message id changes nothing",
      {
        ...base,
        action: "chat.send",
        target: { kind: "origin", origin: { platform: "twitch", channelId: "c" } },
        payload: { message: "hi" },
      },
      { message: "hi" },
    ],
    [
      "another target kind changes nothing",
      { ...base, action: "chat.send", target: { kind: "all" }, payload: { message: "hi" } },
      { message: "hi" },
    ],
    [
      "another action changes nothing",
      {
        ...base,
        action: "chat.announce",
        target: { kind: "origin", origin: { platform: "twitch", messageId: "m-1" } },
        payload: { message: "hi" },
      },
      { message: "hi" },
    ],
  ];
  for (const [name, request, payload] of rows) {
    test(name, () => {
      expect(withOriginReply(request).payload).toEqual(payload);
    });
  }
});
