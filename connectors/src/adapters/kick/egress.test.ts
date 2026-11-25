import { afterEach, describe, expect, test } from "bun:test";
import {
  type EgressActionId,
  type EgressPayloads,
  PLATFORM_IDS,
  type PlatformOutcome,
} from "@woofx3/api/platform-gateway";
import PlatformEvents from "@woofx3/common/cloudevents/Twitch";
import { EgressRegistry } from "../../gateway/egress-registry";
import type { EgressContext, EgressHandlerSpec } from "../../host/adapter";
import { countingIds, FakeTime, halfRandom } from "../../host/testing";
import { SelfSentRegistry } from "../shared/self-sent";
import { SendQueue } from "../shared/send-queue";
import { KickAdapter, kickHostState } from "./adapter";
import { type KickEgressSession, kickEgress } from "./egress";
import { type FakeKickServer, kickError, startFakeKick } from "./fake-kick-server";
import { chatMessageSent } from "./fixtures";
import { normaliseKickDelivery } from "./lib/events";
import { KickApi } from "./lib/kick-api";
import { kickConfigAt } from "./testing";

const BROADCASTER = "4242";

let kick: FakeKickServer;

afterEach(async () => {
  await kick.stop();
});

function context() {
  let marks = 0;
  const ctx: EgressContext = {
    signal: new AbortController().signal,
    deadline: Number.MAX_SAFE_INTEGER,
    requestedBy: { kind: "workflow", ref: "wf-1" },
    workflowChain: "wf-1",
    markSent: () => {
      marks++;
    },
  };
  return { ctx, marks: () => marks };
}

function setup(timeoutMs = 2000) {
  kick = startFakeKick();
  const time = new FakeTime();
  const api = new KickApi({
    fetch,
    token: {
      get: async () => ({
        ok: true,
        token: {
          userId: BROADCASTER,
          accessToken: "token-1",
          scope: [],
          expiresIn: 1,
          obtainmentTimestamp: 0,
          clientId: "a",
        },
      }),
    },
    clock: time,
    baseUrl: kick.url,
    timeoutMs,
    userAgent: "woofx3-test",
    signal: new AbortController().signal,
  });
  const selfSent = new SelfSentRegistry({ capacity: 10, ttlMs: 30_000 }, time);
  const session: KickEgressSession = { kind: "ready", broadcasterUserId: BROADCASTER, api };
  const handlers = kickEgress({ session: () => session, queue: new SendQueue(10), selfSent });
  const perform = async <A extends EgressActionId>(action: A, payload: EgressPayloads[A], ctx = context().ctx) => {
    const spec = handlers[action] as EgressHandlerSpec<A> | undefined;
    if (spec === undefined) {
      throw new Error(`no handler for ${action}`);
    }
    return spec.handle(payload, undefined, ctx);
  };
  return { perform, selfSent, time };
}

describe("Kick egress", () => {
  const delivered: [action: EgressActionId, payload: EgressPayloads[EgressActionId], outcome: PlatformOutcome][] = [
    ["chat.send", { message: "hello chat" }, { status: "delivered", messageId: "msg-0001" }],
    ["chat.delete", { messageId: "m-9" }, { status: "delivered" }],
    ["moderation.timeout", { viewer: "7", durationSeconds: 600 }, { status: "delivered" }],
    ["moderation.ban", { viewer: "7", reason: "spam" }, { status: "delivered" }],
  ];
  for (const [action, payload, outcome] of delivered) {
    test(`${action} is delivered, marked sent before it leaves`, async () => {
      const { perform } = setup();
      const { ctx, marks } = context();
      expect(await perform(action, payload as never, ctx)).toEqual(outcome);
      expect(marks()).toBe(1);
    });
  }

  test("a line above 2048 UTF-8 bytes is refused before it is sent", async () => {
    const { perform } = setup();
    const outcome = await perform("chat.send", { message: "é".repeat(1025) });
    expect(outcome).toMatchObject({ status: "failed", code: "invalid" });
    expect(kick.requests).toEqual([]);
  });

  const timeouts: [seconds: number, minutes: number | null][] = [
    [1, 1],
    [60, 1],
    [61, 2],
    [604_800, 10_080],
    [604_801, null],
  ];
  for (const [seconds, minutes] of timeouts) {
    test(`a ${seconds} s timeout is ${minutes === null ? "refused" : `${minutes} min on Kick`}`, async () => {
      const { perform } = setup();
      const outcome = await perform("moderation.timeout", { viewer: "7", durationSeconds: seconds });
      if (minutes === null) {
        expect(outcome).toMatchObject({ status: "failed", code: "invalid" });
        expect(kick.state.bans).toEqual([]);
      } else {
        expect(outcome).toEqual({ status: "delivered" });
        expect(kick.state.bans).toEqual([{ broadcaster_user_id: 4242, user_id: 7, duration: minutes }]);
      }
    });
  }

  const refusedHere: [name: string, action: EgressActionId, payload: EgressPayloads[EgressActionId]][] = [
    ["the broadcaster", "moderation.ban", { viewer: BROADCASTER }],
    ["a viewer named by login, not id", "moderation.timeout", { viewer: "pup-pal", durationSeconds: 60 }],
    ["a reason over 100 characters", "moderation.ban", { viewer: "7", reason: "x".repeat(101) }],
  ];
  for (const [name, action, payload] of refusedHere) {
    test(`moderating ${name} is refused before it is sent`, async () => {
      const { perform } = setup();
      expect(await perform(action, payload as never)).toMatchObject({ status: "failed", code: "invalid" });
      expect(kick.requests).toEqual([]);
    });
  }

  const statuses: [status: number, code: string][] = [
    [400, "invalid"],
    [401, "forbidden"],
    [403, "forbidden"],
    [429, "rate_limited"],
    [500, "upstream"],
  ];
  for (const [status, code] of statuses) {
    test(`Kick's ${status} is ${code}`, async () => {
      const { perform } = setup();
      kick.state.validTokens.add("token-1");
      kick.route("POST", "/public/v1/chat", () => kickError(status, "nope"));
      expect(await perform("chat.send", { message: "hi" })).toMatchObject({ status: "failed", code });
    });
  }

  test("deleting a line that is gone (404) is invalid", async () => {
    const { perform } = setup();
    kick.route("DELETE", "/public/v1/chat/gone", () => kickError(404, "Not Found"));
    expect(await perform("chat.delete", { messageId: "gone" })).toMatchObject({ status: "failed", code: "invalid" });
  });

  test("no answer after the line left is unconfirmed, never resent", async () => {
    const { perform } = setup(50);
    kick.route("POST", "/public/v1/chat", () => new Promise<Response>(() => {}));
    expect(await perform("chat.send", { message: "hi" })).toMatchObject({ status: "unconfirmed" });
    expect(kick.requests).toHaveLength(1);
  });

  test("the webhook echo of a sent line publishes as the engine's, with the sending workflow's chain", async () => {
    const { perform, selfSent } = setup();
    const sent = await perform("chat.send", { message: "hello chat" });
    if (sent.status !== "delivered" || sent.messageId === undefined) {
      throw new Error("the line was not delivered");
    }
    const echo = {
      ...structuredClone(chatMessageSent),
      message_id: sent.messageId,
      content: "hello chat",
      sender: { ...structuredClone(chatMessageSent.sender), user_id: 4242, channel_slug: "wolfy", username: "Wolfy" },
    };
    const result = normaliseKickDelivery("chat.message.sent", "1", echo, {
      events: new PlatformEvents("kick", "kick"),
      deliveryId: "01ECHO",
      claimOwnLine: (line) => selfSent.claimEcho(line),
      redemptionPublished: () => false,
      unknownBadge: () => {},
    });
    if (result.kind !== "events") {
      throw new Error("the echo published nothing");
    }
    const event = JSON.parse(new TextDecoder().decode(result.events[0]?.[1]));
    expect(event).toMatchObject({ workflowChain: "wf-1", data: { fromEngine: true } });
  });

  test("announcements, pins and warnings are unsupported on Kick", () => {
    const time = new FakeTime();
    const deps = {
      config: kickConfigAt("http://kick.test"),
      clock: time,
      timers: time,
      random: halfRandom,
      ids: countingIds(),
      fetch,
    };
    kick = startFakeKick();
    const registry = EgressRegistry.fromManifests([new KickAdapter(deps, kickHostState(deps)).manifest], PLATFORM_IDS);
    expect(
      (
        [
          "chat.send",
          "chat.delete",
          "moderation.timeout",
          "moderation.ban",
          "chat.announce",
          "chat.pin",
          "moderation.warn",
        ] as const
      ).map((action) => registry.supports("kick", action))
    ).toEqual([true, true, true, true, false, false, false]);
  });
});
