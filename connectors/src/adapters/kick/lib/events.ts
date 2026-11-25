import type { ChatterMembership } from "@woofx3/common/cloudevents/Chat/events";
import type { SchemaStreamStatusObserved } from "@woofx3/common/cloudevents/messages.gen";
import type PlatformEvents from "@woofx3/common/cloudevents/Twitch";
import { z } from "zod";
import type { EventTuple } from "../../shared/publish-event";
import type { ChatEcho, SelfSentClaim } from "../../shared/self-sent";

/** A Kick event type and version, as `Kick-Event-Type` and `Kick-Event-Version` name it. */
export type KickEventKey = `${string}@${string}`;

/**
 * What a delivery needs from outside its body: the builder that stamps the
 * events with platform kick, and the adapter's memory of its own chat lines
 * and of redemptions already seen.
 */
export interface NormaliseContext {
  events: PlatformEvents;
  /** `Kick-Event-Message-Id`, which keys events Kick gives no id of their own. */
  deliveryId: string;
  /** The engine's own line behind a chat message, claimed so it matches once; null for anyone else's. */
  claimOwnLine(echo: ChatEcho): SelfSentClaim | null;
  /** True the first time a redemption id is seen, false on every later update of it. */
  firstSighting(redemptionId: string): boolean;
  /** Told once per badge type the mapping does not know, so a new Kick role shows in the log. */
  unknownBadge(type: string): void;
}

/**
 * - events: publish these, in order; `live` also says the stream changed state;
 * - ignored: nothing to publish (an unknown event, or an update that changes nothing);
 * - malformed: the body is not the documented shape for its event type.
 */
export type NormaliseResult =
  | { kind: "events"; events: EventTuple[]; live?: SchemaStreamStatusObserved }
  | { kind: "ignored"; reason: string }
  | { kind: "malformed"; detail: string };

const KickId = z.number().int().nonnegative();

const KickUserSchema = z.object({
  is_anonymous: z.boolean().optional(),
  user_id: KickId.nullable(),
  username: z.string().nullable(),
  channel_slug: z.string().nullable(),
});

const BroadcasterSchema = z.object({ user_id: KickId, username: z.string(), channel_slug: z.string() });

const BadgeSchema = z.object({ text: z.string(), type: z.string(), count: z.number().optional() });

const ChatMessageSentSchema = z.object({
  message_id: z.string().min(1),
  broadcaster: BroadcasterSchema,
  sender: z.object({
    user_id: KickId,
    username: z.string(),
    channel_slug: z.string(),
    identity: z.object({ badges: z.array(BadgeSchema) }).nullable(),
  }),
  content: z.string(),
});

const FollowedSchema = z.object({
  broadcaster: BroadcasterSchema,
  follower: z.object({ user_id: KickId, username: z.string() }),
});

const SubscriptionSchema = z.object({
  broadcaster: BroadcasterSchema,
  subscriber: z.object({ user_id: KickId, username: z.string() }),
  duration: z.number().int().nonnegative(),
});

const GiftsSchema = z.object({
  broadcaster: BroadcasterSchema,
  gifter: KickUserSchema,
  giftees: z.array(z.object({ user_id: KickId, username: z.string() })).min(1),
});

const RedemptionSchema = z.object({
  id: z.string().min(1),
  broadcaster: BroadcasterSchema,
  user_input: z.string().nullish(),
  status: z.enum(["pending", "accepted", "rejected"]),
  reward: z.object({ id: z.string(), title: z.string(), cost: z.number().int() }),
  redeemer: z.object({ user_id: KickId, username: z.string() }),
});

const LivestreamStatusSchema = z.object({
  broadcaster: BroadcasterSchema,
  is_live: z.boolean(),
  started_at: z.string().nullish(),
});

const KicksGiftedSchema = z.object({
  broadcaster: BroadcasterSchema,
  sender: z.object({ user_id: KickId.nullable(), username: z.string().nullable() }),
  gift: z.object({
    amount: z.number().int().nonnegative(),
    name: z.string(),
    type: z.string(),
    tier: z.string(),
    message: z.string().nullish(),
  }),
});

/** Kick has one subscription level; woofx3's tier field reports it as Tier 1. */
export const KICK_SUBSCRIPTION_TIER = "1000";

/** Badge types that set a membership flag. Anything else is reported through `unknownBadge`. */
const MEMBERSHIP_BADGES: Readonly<Record<string, keyof Omit<ChatterMembership, "isFollower" | "subscriberTier">>> = {
  broadcaster: "isBroadcaster",
  moderator: "isModerator",
  subscriber: "isSubscriber",
  vip: "isVip",
};

/** Badge types Kick sends that carry no membership woofx3 tracks. */
const NON_MEMBERSHIP_BADGES: ReadonlySet<string> = new Set(["sub_gifter", "founder", "og", "verified", "staff"]);

type Normaliser = (body: unknown, ctx: NormaliseContext) => NormaliseResult;

function parse<S extends z.ZodType>(schema: S, body: unknown): { ok: true; value: z.infer<S> } | NormaliseResult {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    return { kind: "malformed", detail: `${issue?.path.join(".") ?? ""}: ${issue?.message ?? "unexpected shape"}` };
  }
  return { ok: true, value: result.data };
}

function isParsed<T>(result: { ok: true; value: T } | NormaliseResult): result is { ok: true; value: T } {
  return "ok" in result;
}

/** `[emote:<id>:<name>]` tokens become `<name>`, as Twitch's text carries emote names. */
export function emoteNames(content: string): string {
  return content.replace(/\[emote:\d+:([^\]\s]+)\]/g, "$1");
}

function membership(
  badges: readonly z.infer<typeof BadgeSchema>[],
  unknownBadge: (type: string) => void
): ChatterMembership {
  const flags: ChatterMembership = { isBroadcaster: false, isModerator: false, isSubscriber: false, isVip: false };
  for (const badge of badges) {
    const flag = MEMBERSHIP_BADGES[badge.type];
    if (flag !== undefined) {
      flags[flag] = true;
      continue;
    }
    if (!NON_MEMBERSHIP_BADGES.has(badge.type)) {
      unknownBadge(badge.type);
    }
  }
  return flags;
}

const chatMessageSent: Normaliser = (body, ctx) => {
  const parsed = parse(ChatMessageSentSchema, body);
  if (!isParsed(parsed)) {
    return parsed;
  }
  const line = parsed.value;
  const ownLine = ctx.claimOwnLine({
    messageId: line.message_id,
    text: line.content,
    fromBroadcaster: line.sender.user_id === line.broadcaster.user_id,
  });
  return {
    kind: "events",
    events: [
      ctx.events.chatMessage(
        {
          messageId: line.message_id,
          amount: 0,
          isPaid: false,
          channelId: null,
          channelName: null,
          chatterId: String(line.sender.user_id),
          chatterName: line.sender.username,
          chatterLogin: line.sender.channel_slug,
          message: emoteNames(line.content),
          membership: membership(line.sender.identity?.badges ?? [], ctx.unknownBadge),
          fromEngine: ownLine !== null,
        },
        { workflowChain: ownLine?.workflowChain }
      ),
    ],
  };
};

const followed: Normaliser = (body, ctx) => {
  const parsed = parse(FollowedSchema, body);
  if (!isParsed(parsed)) {
    return parsed;
  }
  const { follower } = parsed.value;
  return {
    kind: "events",
    events: [ctx.events.follow({ userId: String(follower.user_id), userName: follower.username })],
  };
};

const subscriptionNew: Normaliser = (body, ctx) => {
  const parsed = parse(SubscriptionSchema, body);
  if (!isParsed(parsed)) {
    return parsed;
  }
  const { subscriber } = parsed.value;
  return {
    kind: "events",
    events: [
      ctx.events.subscribe({
        isGift: false,
        isCommunityGift: false,
        tier: KICK_SUBSCRIPTION_TIER,
        userId: String(subscriber.user_id),
        userName: subscriber.username,
      }),
    ],
  };
};

const subscriptionRenewal: Normaliser = (body, ctx) => {
  const parsed = parse(SubscriptionSchema, body);
  if (!isParsed(parsed)) {
    return parsed;
  }
  const { subscriber, broadcaster, duration } = parsed.value;
  return {
    kind: "events",
    events: [
      ctx.events.resub({
        chatterId: String(subscriber.user_id),
        chatterName: subscriber.username,
        chatterIsAnonymous: false,
        messageId: ctx.deliveryId,
        messageText: "",
        sourceBroadcasterId: null,
        sourceBroadcasterName: null,
        broadcasterId: String(broadcaster.user_id),
        broadcasterName: broadcaster.username,
        tier: KICK_SUBSCRIPTION_TIER,
        isPrime: false,
        durationMonths: 1,
        cumulativeMonths: duration,
        streakMonths: null,
        isGift: false,
        gifterIsAnonymous: null,
        gifterId: null,
        gifterName: null,
      }),
    ],
  };
};

const subscriptionGifts: Normaliser = (body, ctx) => {
  const parsed = parse(GiftsSchema, body);
  if (!isParsed(parsed)) {
    return parsed;
  }
  const { gifter, giftees } = parsed.value;
  const anonymous = gifter.is_anonymous === true || gifter.user_id === null;
  const community = giftees.length > 1;
  const events: EventTuple[] = [];
  if (community) {
    events.push(
      ctx.events.subscriptionGift({
        amount: giftees.length,
        gifterId: anonymous ? "" : String(gifter.user_id),
        gifterName: anonymous ? "" : (gifter.username ?? ""),
        isAnonymous: anonymous,
        tier: KICK_SUBSCRIPTION_TIER,
      })
    );
  }
  for (const giftee of giftees) {
    events.push(
      ctx.events.subscribe({
        isGift: true,
        isCommunityGift: community,
        tier: KICK_SUBSCRIPTION_TIER,
        userId: String(giftee.user_id),
        userName: giftee.username,
      })
    );
  }
  return { kind: "events", events };
};

const redemptionUpdated: Normaliser = (body, ctx) => {
  const parsed = parse(RedemptionSchema, body);
  if (!isParsed(parsed)) {
    return parsed;
  }
  const redemption = parsed.value;
  if (redemption.status === "rejected") {
    return { kind: "ignored", reason: "a rejected redemption" };
  }
  if (!ctx.firstSighting(redemption.id)) {
    return { kind: "ignored", reason: "an update of a redemption already published" };
  }
  const input = redemption.user_input ?? "";
  return {
    kind: "events",
    events: [
      ctx.events.redeem({
        redeemId: redemption.id,
        rewardId: redemption.reward.id,
        rewardTitle: redemption.reward.title,
        rewardCost: redemption.reward.cost,
        userId: String(redemption.redeemer.user_id),
        userName: redemption.redeemer.username,
        ...(input === "" ? {} : { message: input }),
      }),
    ],
  };
};

const livestreamStatus: Normaliser = (body, ctx) => {
  const parsed = parse(LivestreamStatusSchema, body);
  if (!isParsed(parsed)) {
    return parsed;
  }
  const { broadcaster, is_live: isLive, started_at: startedAt } = parsed.value;
  const who = { broadcasterUserId: String(broadcaster.user_id), broadcasterUserName: broadcaster.username };
  if (!isLive) {
    return { kind: "events", events: [ctx.events.streamOffline(who)], live: { live: false } };
  }
  if (startedAt == null || Number.isNaN(Date.parse(startedAt))) {
    return { kind: "malformed", detail: "started_at: a live stream needs its start time" };
  }
  const started = new Date(startedAt).toISOString();
  return {
    kind: "events",
    events: [ctx.events.streamOnline({ ...who, startedAt: started })],
    live: { live: true, startedAt: started },
  };
};

const kicksGifted: Normaliser = (body, ctx) => {
  const parsed = parse(KicksGiftedSchema, body);
  if (!isParsed(parsed)) {
    return parsed;
  }
  const { sender, gift } = parsed.value;
  const anonymous = sender.user_id === null;
  return {
    kind: "events",
    events: [
      ctx.events.kicks({
        amount: gift.amount,
        giftName: gift.name,
        giftType: gift.type,
        giftTier: gift.tier,
        message: gift.message ?? "",
        userId: anonymous ? null : String(sender.user_id),
        userName: anonymous ? null : sender.username,
        isAnonymous: anonymous,
      }),
    ],
  };
};

/** One normaliser per Kick event this adapter subscribes to. */
export const KICK_EVENT_NORMALISERS: Readonly<Record<string, Normaliser>> = {
  "chat.message.sent@1": chatMessageSent,
  "channel.followed@1": followed,
  "channel.subscription.new@1": subscriptionNew,
  "channel.subscription.renewal@1": subscriptionRenewal,
  "channel.subscription.gifts@1": subscriptionGifts,
  "channel.reward.redemption.updated@1": redemptionUpdated,
  "livestream.status.updated@1": livestreamStatus,
  "kicks.gifted@1": kicksGifted,
};

/** The woofx3 events one Kick delivery becomes. */
export function normaliseKickDelivery(
  eventType: string,
  eventVersion: string,
  body: unknown,
  ctx: NormaliseContext
): NormaliseResult {
  const normaliser = KICK_EVENT_NORMALISERS[`${eventType}@${eventVersion}`];
  if (normaliser === undefined) {
    return { kind: "ignored", reason: `no mapping for ${eventType} version ${eventVersion}` };
  }
  return normaliser(body, ctx);
}
