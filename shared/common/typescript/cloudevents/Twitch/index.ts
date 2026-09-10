import Event from "../BaseEvent";
import { encode } from "../utils";
import * as TwitchEvent from "./events";

export * from "./events";
export * from "./messages";

type EventTuple = [string, Uint8Array];

/** Provenance stamped on every event this builder emits. */
const PLATFORM = "twitch";

export default class TwitchEvents {
  constructor(private source: string) {}

  chatMessage(event: TwitchEvent.ChatMessage): EventTuple {
    return this.encodeEvent(TwitchEvent.EventType.ChatMessage, event);
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
  private encodeEvent(type: TwitchEvent.EventType, event: any): EventTuple {
    return [type, encode(Event({ type, source: this.source, platform: PLATFORM }, event))];
  }
}
