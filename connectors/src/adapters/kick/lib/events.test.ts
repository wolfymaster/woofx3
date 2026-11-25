import { describe, expect, test } from "bun:test";
import PlatformEvents from "@woofx3/common/cloudevents/Twitch";
import type { SelfSentClaim } from "../../shared/self-sent";
import {
  chatMessageSent as chatMessage,
  channelFollowed as followed,
  subscriptionGifts as gifts,
  kicksGifted,
  livestreamStatusUpdated as livestream,
  redemptionUpdated as redemption,
  subscriptionRenewal as renewal,
  subscriptionNew,
} from "../fixtures";
import { emoteNames, type NormaliseContext, type NormaliseResult, normaliseKickDelivery } from "./events";

interface Recorder {
  ctx: NormaliseContext;
  unknownBadges: string[];
  claimed: string[];
}

function context(own: Record<string, SelfSentClaim> = {}, seen = new Set<string>()): Recorder {
  const unknownBadges: string[] = [];
  const claimed: string[] = [];
  return {
    unknownBadges,
    claimed,
    ctx: {
      events: new PlatformEvents("kick", "kick"),
      deliveryId: "01DELIVERY",
      claimOwnLine: (echo) => {
        claimed.push(echo.messageId);
        return own[echo.messageId] ?? null;
      },
      firstSighting: (id) => {
        if (seen.has(id)) {
          return false;
        }
        seen.add(id);
        return true;
      },
      unknownBadge: (type) => {
        unknownBadges.push(type);
      },
    },
  };
}

/** Each published event as [subject, its CloudEvent]. */
function published(result: NormaliseResult): [string, Record<string, unknown>][] {
  if (result.kind !== "events") {
    throw new Error(`expected events, got ${JSON.stringify(result)}`);
  }
  return result.events.map(([subject, data]) => [subject, JSON.parse(new TextDecoder().decode(data))]);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("normaliseKickDelivery, one row per subscribed event", () => {
  const rows: [event: string, body: unknown, subjects: string[], firstData: Record<string, unknown>][] = [
    [
      "chat.message.sent",
      chatMessage,
      ["user.message"],
      {
        messageId: "msg-0001",
        amount: 0,
        isPaid: false,
        channelId: null,
        channelName: null,
        chatterId: "777",
        chatterName: "Pup_Pal",
        chatterLogin: "pup-pal",
        message: "hello HYPERCLAP wolfy",
        membership: { isBroadcaster: false, isModerator: true, isSubscriber: true, isVip: false },
        fromEngine: false,
      },
    ],
    ["channel.followed", followed, ["channel.follow"], { userId: "777", userName: "Pup_Pal" }],
    [
      "channel.subscription.new",
      subscriptionNew,
      ["channel.subscribe"],
      { isGift: false, isCommunityGift: false, tier: "1000", userId: "777", userName: "Pup_Pal" },
    ],
    [
      "channel.subscription.renewal",
      renewal,
      ["channel.resub"],
      {
        chatterId: "777",
        chatterName: "Pup_Pal",
        chatterIsAnonymous: false,
        messageId: "01DELIVERY",
        messageText: "",
        sourceBroadcasterId: null,
        sourceBroadcasterName: null,
        broadcasterId: "4242",
        broadcasterName: "Wolfy",
        tier: "1000",
        isPrime: false,
        durationMonths: 1,
        cumulativeMonths: 6,
        streakMonths: null,
        isGift: false,
        gifterIsAnonymous: null,
        gifterId: null,
        gifterName: null,
      },
    ],
    [
      "channel.subscription.gifts",
      gifts,
      ["channel.subscriptionGift", "channel.subscribe", "channel.subscribe", "channel.subscribe"],
      { amount: 3, gifterId: "555", gifterName: "Gifty", isAnonymous: false, tier: "1000" },
    ],
    [
      "channel.reward.redemption.updated",
      redemption,
      ["channelpoints.redeem"],
      {
        redeemId: "01REDEMPTION",
        rewardId: "01REWARD",
        rewardTitle: "Hydrate",
        rewardCost: 100,
        userId: "777",
        userName: "Pup_Pal",
        message: "play the howl",
      },
    ],
    [
      "livestream.status.updated",
      livestream,
      ["stream.online"],
      { broadcasterUserId: "4242", broadcasterUserName: "Wolfy", startedAt: "2026-11-25T10:00:00.000Z" },
    ],
    [
      "kicks.gifted",
      kicksGifted,
      ["channel.kicks"],
      {
        amount: 100,
        giftName: "Full Send",
        giftType: "BASIC",
        giftTier: "BASIC",
        message: "w",
        userId: "777",
        userName: "Pup_Pal",
        isAnonymous: false,
      },
    ],
  ];
  for (const [event, body, subjects, firstData] of rows) {
    test(`${event} becomes ${subjects.join(", ")}, stamped platform kick`, () => {
      const events = published(normaliseKickDelivery(event, "1", clone(body), context().ctx));
      expect(events.map(([subject]) => subject)).toEqual(subjects);
      expect(events[0]?.[1]).toMatchObject({ platform: "kick", source: "kick", data: firstData });
    });
  }
});

describe("normaliseKickDelivery quirks", () => {
  test("an anonymous gifter's community gift names nobody", () => {
    const body = clone(gifts);
    body.gifter = { ...body.gifter, is_anonymous: true, user_id: null, username: null, channel_slug: null } as never;
    const [first] = published(normaliseKickDelivery("channel.subscription.gifts", "1", body, context().ctx));
    expect(first?.[1].data).toMatchObject({ gifterId: "", gifterName: "", isAnonymous: true, amount: 3 });
  });

  test("one giftee is one gifted sub, with no community gift", () => {
    const body = clone(gifts);
    body.giftees = body.giftees.slice(0, 1);
    const events = published(normaliseKickDelivery("channel.subscription.gifts", "1", body, context().ctx));
    expect(events.map(([subject, event]) => [subject, event.data])).toEqual([
      ["channel.subscribe", { isGift: true, isCommunityGift: false, tier: "1000", userId: "1", userName: "One" }],
    ]);
  });

  test("every giftee of a community gift is a community gifted sub", () => {
    const events = published(normaliseKickDelivery("channel.subscription.gifts", "1", clone(gifts), context().ctx));
    expect(events.slice(1).map(([, event]) => event.data)).toEqual([
      { isGift: true, isCommunityGift: true, tier: "1000", userId: "1", userName: "One" },
      { isGift: true, isCommunityGift: true, tier: "1000", userId: "2", userName: "Two" },
      { isGift: true, isCommunityGift: true, tier: "1000", userId: "3", userName: "Three" },
    ]);
  });

  const emotes: [name: string, content: string, text: string][] = [
    ["one token", "hi [emote:1:Wave]", "hi Wave"],
    ["adjacent tokens", "[emote:1:A][emote:2:B]", "AB"],
    ["a malformed token, left as typed", "[emote:x:Bad] [emote:3]", "[emote:x:Bad] [emote:3]"],
    ["no token", "plain", "plain"],
  ];
  for (const [name, content, text] of emotes) {
    test(`emote names: ${name}`, () => {
      expect(emoteNames(content)).toBe(text);
    });
  }

  test("an unknown badge type is reported and sets no membership", () => {
    const body = clone(chatMessage);
    body.sender.identity.badges = [
      { text: "Mystery", type: "mystery" },
      { text: "Gifter", type: "sub_gifter" },
    ] as never;
    const recorder = context();
    const [line] = published(normaliseKickDelivery("chat.message.sent", "1", body, recorder.ctx));
    expect(line?.[1].data).toMatchObject({
      membership: { isBroadcaster: false, isModerator: false, isSubscriber: false, isVip: false },
    });
    expect(recorder.unknownBadges).toEqual(["mystery"]);
  });

  test("the engine's own line publishes as the engine's, with the workflow chain that said it", () => {
    const [line] = published(
      normaliseKickDelivery(
        "chat.message.sent",
        "1",
        clone(chatMessage),
        context({ "msg-0001": { workflowChain: "wf-1" } }).ctx
      )
    );
    expect(line?.[1]).toMatchObject({ workflowChain: "wf-1", data: { fromEngine: true } });
  });

  const redemptions: [name: string, statuses: string[], published: number[]][] = [
    ["pending then accepted publishes once", ["pending", "accepted"], [1, 0]],
    ["accepted on first sight publishes", ["accepted"], [1]],
    ["rejected publishes nothing", ["rejected"], [0]],
    ["a repeat of the same update publishes nothing", ["pending", "pending"], [1, 0]],
  ];
  for (const [name, statuses, counts] of redemptions) {
    test(`redemption: ${name}`, () => {
      const recorder = context();
      const result = statuses.map((status) => {
        const outcome = normaliseKickDelivery(
          "channel.reward.redemption.updated",
          "1",
          { ...clone(redemption), status },
          recorder.ctx
        );
        return outcome.kind === "events" ? outcome.events.length : 0;
      });
      expect(result).toEqual(counts);
    });
  }

  test("a stream that ended goes offline and says so to the live status", () => {
    const body = { ...clone(livestream), is_live: false, ended_at: "2026-11-25T12:00:00Z" };
    const result = normaliseKickDelivery("livestream.status.updated", "1", body, context().ctx);
    expect(published(result).map(([subject, event]) => [subject, event.data])).toEqual([
      ["stream.offline", { broadcasterUserId: "4242", broadcasterUserName: "Wolfy" }],
    ]);
    expect(result).toMatchObject({ live: { live: false } });
  });

  const ignored: [name: string, event: string, version: string][] = [
    ["an unknown event", "moderation.banned", "1"],
    ["an unknown version", "chat.message.sent", "2"],
  ];
  for (const [name, event, version] of ignored) {
    test(`${name} is ignored`, () => {
      expect(normaliseKickDelivery(event, version, {}, context().ctx)).toMatchObject({ kind: "ignored" });
    });
  }

  const malformed: [name: string, event: string, body: unknown][] = [
    ["a chat message without a sender", "chat.message.sent", { ...clone(chatMessage), sender: undefined }],
    [
      "a follow whose follower id is a string",
      "channel.followed",
      { ...clone(followed), follower: { user_id: "x", username: "a" } },
    ],
    ["a live stream without a start", "livestream.status.updated", { ...clone(livestream), started_at: null }],
    ["gifts to nobody", "channel.subscription.gifts", { ...clone(gifts), giftees: [] }],
  ];
  for (const [name, event, body] of malformed) {
    test(`${name} is malformed`, () => {
      expect(normaliseKickDelivery(event, "1", body, context().ctx)).toMatchObject({ kind: "malformed" });
    });
  }
});
