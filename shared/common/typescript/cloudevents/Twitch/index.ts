import Event, { type BaseEvent } from "../BaseEvent";
import { encode } from "../utils";
import * as TwitchEvent from "./events";

export * from "./events";
export * from "./messages";

type EventTuple = [string, Uint8Array];

/** The payload each event type carries. A new event type does not compile until it is listed here. */
export interface TwitchEventPayloads {
  [TwitchEvent.EventType.ChatMessage]: TwitchEvent.ChatMessage;
  [TwitchEvent.EventType.Cheer]: TwitchEvent.Cheer;
  [TwitchEvent.EventType.Follow]: TwitchEvent.Follow;
  [TwitchEvent.EventType.HypeTrainBegin]: TwitchEvent.HypeTrainBegin;
  [TwitchEvent.EventType.Raid]: TwitchEvent.Raid;
  [TwitchEvent.EventType.Redeem]: TwitchEvent.Redeem;
  [TwitchEvent.EventType.StreamOnline]: TwitchEvent.StreamOnline;
  [TwitchEvent.EventType.StreamOffline]: TwitchEvent.StreamOffline;
  [TwitchEvent.EventType.Subscribe]: TwitchEvent.Subscribe;
  [TwitchEvent.EventType.SubscriptionGift]: TwitchEvent.SubscriptionGift;
  [TwitchEvent.EventType.Resub]: TwitchEvent.Resub;
  [TwitchEvent.EventType.GiftPaidUpgrade]: TwitchEvent.GiftPaidUpgrade;
  [TwitchEvent.EventType.PrimePaidUpgrade]: TwitchEvent.PrimePaidUpgrade;
  [TwitchEvent.EventType.Unraid]: TwitchEvent.Unraid;
  [TwitchEvent.EventType.PayItForward]: TwitchEvent.PayItForward;
  [TwitchEvent.EventType.Announcement]: TwitchEvent.Announcement;
  [TwitchEvent.EventType.CharityDonation]: TwitchEvent.CharityDonation;
  [TwitchEvent.EventType.BitsBadgeTier]: TwitchEvent.BitsBadgeTier;
  [TwitchEvent.EventType.WatchStreak]: TwitchEvent.WatchStreak;
  [TwitchEvent.EventType.SharedSubscribe]: TwitchEvent.SharedSubscribe;
  [TwitchEvent.EventType.SharedSubscriptionGift]: TwitchEvent.SharedSubscriptionGift;
  [TwitchEvent.EventType.SharedRaid]: TwitchEvent.SharedRaid;
  [TwitchEvent.EventType.SharedResub]: TwitchEvent.SharedResub;
  [TwitchEvent.EventType.SharedGiftPaidUpgrade]: TwitchEvent.SharedGiftPaidUpgrade;
  [TwitchEvent.EventType.SharedPrimePaidUpgrade]: TwitchEvent.SharedPrimePaidUpgrade;
  [TwitchEvent.EventType.SharedPayItForward]: TwitchEvent.SharedPayItForward;
  [TwitchEvent.EventType.SharedAnnouncement]: TwitchEvent.SharedAnnouncement;
  [TwitchEvent.EventType.AdBreakUpcoming]: TwitchEvent.AdBreakUpcoming;
  [TwitchEvent.EventType.AdBreakBegin]: TwitchEvent.AdBreakBegin;
  [TwitchEvent.EventType.AdBreakEnd]: TwitchEvent.AdBreakEnd;
}

/**
 * Throws unless `value` is JSON data built from plain objects, arrays and
 * primitives.
 *
 * Platform SDK events are class instances whose real fields sit behind
 * getters while the API client, and the credentials it holds, are own
 * properties. Serializing one directly publishes the credentials and drops the
 * data, so every payload must be mapped field by field into a plain object
 * first, and this check makes forgetting to do so fail at the publish call.
 */
export function assertPlainPayload(value: unknown): void {
  walkPayload(value, "payload", []);
}

function walkPayload(value: unknown, path: string, ancestors: object[]): void {
  if (value === null) {
    return;
  }
  const kind = typeof value;
  if (kind === "number") {
    // JSON turns NaN and Infinity into null without warning.
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} is ${String(value)}; event payloads may only hold finite numbers`);
    }
    return;
  }
  if (kind === "string" || kind === "boolean" || kind === "undefined") {
    return;
  }
  if (kind !== "object") {
    throw new TypeError(`${path} is a ${kind}; event payloads may only hold JSON data`);
  }
  const object = value as object;
  if (ancestors.includes(object)) {
    throw new TypeError(`${path} refers back to one of its own ancestors; event payloads must be trees`);
  }
  const nested = [...ancestors, object];
  if (Array.isArray(object)) {
    object.forEach((item, index) => {
      walkPayload(item, `${path}[${index}]`, nested);
    });
    return;
  }
  const prototype = Object.getPrototypeOf(object);
  if (prototype !== Object.prototype && prototype !== null) {
    const name = (prototype?.constructor as { name?: string } | undefined)?.name ?? "unknown";
    throw new TypeError(`${path} is an instance of ${name}; map it into a plain object before publishing`);
  }
  for (const [key, field] of Object.entries(object)) {
    walkPayload(field, `${path}.${key}`, nested);
  }
}

/** Provenance stamped on every event this builder emits. */
const PLATFORM = "twitch";

export default class TwitchEvents {
  constructor(private source: string) {}

  chatMessage(event: TwitchEvent.ChatMessage, attributes: TwitchEvent.ChatMessageAttributes = {}): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.ChatMessage, event, attributes);
  }

  cheer(event: TwitchEvent.Cheer): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.Cheer, event);
  }

  follow(event: TwitchEvent.Follow): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.Follow, event);
  }

  hypeTrainBegin(event: TwitchEvent.HypeTrainBegin): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.HypeTrainBegin, event);
  }

  raid(event: TwitchEvent.Raid): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.Raid, event);
  }

  redeem(event: TwitchEvent.Redeem): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.Redeem, event);
  }

  adBreakUpcoming(event: TwitchEvent.AdBreakUpcoming): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.AdBreakUpcoming, event);
  }

  adBreakBegin(event: TwitchEvent.AdBreakBegin): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.AdBreakBegin, event);
  }

  adBreakEnd(event: TwitchEvent.AdBreakEnd): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.AdBreakEnd, event);
  }

  streamOnline(event: TwitchEvent.StreamOnline): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.StreamOnline, event);
  }

  streamOffline(event: TwitchEvent.StreamOffline): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.StreamOffline, event);
  }

  subscribe(event: TwitchEvent.Subscribe): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.Subscribe, event);
  }

  subscriptionGift(event: TwitchEvent.SubscriptionGift): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.SubscriptionGift, event);
  }

  resub(event: TwitchEvent.Resub): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.Resub, event);
  }

  giftPaidUpgrade(event: TwitchEvent.GiftPaidUpgrade): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.GiftPaidUpgrade, event);
  }

  primePaidUpgrade(event: TwitchEvent.PrimePaidUpgrade): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.PrimePaidUpgrade, event);
  }

  unraid(event: TwitchEvent.Unraid): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.Unraid, event);
  }

  payItForward(event: TwitchEvent.PayItForward): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.PayItForward, event);
  }

  announcement(event: TwitchEvent.Announcement): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.Announcement, event);
  }

  charityDonation(event: TwitchEvent.CharityDonation): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.CharityDonation, event);
  }

  bitsBadgeTier(event: TwitchEvent.BitsBadgeTier): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.BitsBadgeTier, event);
  }

  watchStreak(event: TwitchEvent.WatchStreak): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.WatchStreak, event);
  }

  sharedSubscribe(event: TwitchEvent.SharedSubscribe): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.SharedSubscribe, event);
  }

  sharedSubscriptionGift(event: TwitchEvent.SharedSubscriptionGift): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.SharedSubscriptionGift, event);
  }

  sharedRaid(event: TwitchEvent.SharedRaid): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.SharedRaid, event);
  }

  sharedResub(event: TwitchEvent.SharedResub): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.SharedResub, event);
  }

  sharedGiftPaidUpgrade(event: TwitchEvent.SharedGiftPaidUpgrade): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.SharedGiftPaidUpgrade, event);
  }

  sharedPrimePaidUpgrade(event: TwitchEvent.SharedPrimePaidUpgrade): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.SharedPrimePaidUpgrade, event);
  }

  sharedPayItForward(event: TwitchEvent.SharedPayItForward): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.SharedPayItForward, event);
  }

  sharedAnnouncement(event: TwitchEvent.SharedAnnouncement): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.SharedAnnouncement, event);
  }

  /** The tuple is `[NATS subject, encoded CloudEvent]`; the subject is the
   *  event type. Every event this class builds is stamped with its platform
   *  here rather than at each call site, so a new event cannot be added
   *  without provenance. */
  private encodeEvent<T extends TwitchEvent.EventType>(
    type: T,
    event: TwitchEventPayloads[T],
    attributes: Pick<BaseEvent<unknown>, "workflowChain"> = {}
  ): EventTuple {
    assertPlainPayload(event);
    return [type, encode(Event({ ...attributes, type, source: this.source, platform: PLATFORM }, event))];
  }
}
