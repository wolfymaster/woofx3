import type { SharedLogger } from "@woofx3/common/logging";
import type { AlertContext } from "@woofx3/common/cloudevents/Alert/events";
import type {
  Cheer,
  Follow,
  HypeTrainBegin,
  Raid,
  StreamOnline,
  Subscribe,
  SubscriptionGift,
} from "@woofx3/common/cloudevents/Twitch/events";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import type { ConvexWebhookClient } from "./convex-webhook-client";

const SUBJECT_FOLLOW = "follow.user.twitch";
const SUBJECT_CHEER = "cheer.user.twitch";
const SUBJECT_SUBSCRIBE = "subscribe.user.twitch";
const SUBJECT_SUB_GIFT = "subscription.gift.twitch";
const SUBJECT_HYPETRAIN = "hypetrain.channel.twitch";
const SUBJECT_RAID = "raid.user.twitch";
const SUBJECT_STREAM_ONLINE = "online.user.twitch";

interface CloudEventEnvelope<T> {
  type?: string;
  data?: T;
  [key: string]: unknown;
}

type Mapper<T> = (data: T) => AlertContext | null;

export class AlertEmitter {
  private channelId: string;

  constructor(
    private nats: NATSClient,
    private webhook: ConvexWebhookClient,
    channelId: string,
    private logger: SharedLogger
  ) {
    this.channelId = channelId;
  }

  setChannelId(channelId: string): void {
    this.channelId = channelId;
  }

  async start(): Promise<void> {
    await this.bind<Follow>(SUBJECT_FOLLOW, mapFollow);
    await this.bind<Cheer>(SUBJECT_CHEER, mapCheer);
    await this.bind<Subscribe>(SUBJECT_SUBSCRIBE, mapSubscribe);
    await this.bind<SubscriptionGift>(SUBJECT_SUB_GIFT, mapSubGift);
    await this.bind<HypeTrainBegin>(SUBJECT_HYPETRAIN, mapHypeTrain);
    await this.bind<Raid>(SUBJECT_RAID, mapRaid);
    await this.bind<StreamOnline>(SUBJECT_STREAM_ONLINE, mapStreamOnline);
    this.logger.info("AlertEmitter started", { channelId: this.channelId });
  }

  private async bind<T>(subject: string, mapper: Mapper<T>): Promise<void> {
    await this.nats.subscribe(subject, (msg: Msg) => {
      this.handle(subject, msg, mapper);
    });
  }

  private handle<T>(subject: string, msg: Msg, mapper: Mapper<T>): void {
    let ctx: AlertContext | null;
    try {
      const ce = msg.json() as CloudEventEnvelope<T>;
      const data = (ce.data ?? ce) as T;
      ctx = mapper(data);
    } catch (err) {
      this.logger.error("AlertEmitter: failed to decode CloudEvent", {
        subject,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (!ctx) {
      return;
    }
    void this.webhook.sendAlert(this.channelId, ctx).catch((err) => {
      this.logger.error("AlertEmitter: webhook delivery threw", {
        subject,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

// Pure mapping functions, exported for direct unit testing.

export function mapFollow(d: Follow): AlertContext {
  return { type: "follow", user: d.userName };
}

export function mapCheer(d: Cheer): AlertContext {
  return {
    type: "cheer",
    user: d.userName ?? "anonymous",
    amount: d.amount,
    message: d.message,
    metadata: { isAnonymous: d.isAnonymous },
  };
}

export function mapSubscribe(d: Subscribe): AlertContext {
  return {
    type: "subscribe",
    user: d.userName ?? "anonymous",
    metadata: { tier: d.tier, isGift: d.isGift },
  };
}

export function mapSubGift(d: SubscriptionGift): AlertContext {
  return {
    type: "sub_gift",
    user: d.isAnonymous ? "anonymous" : d.gifterName,
    amount: d.amount,
    metadata: { tier: d.tier, isAnonymous: d.isAnonymous },
  };
}

export function mapHypeTrain(_d: HypeTrainBegin): AlertContext {
  return { type: "hypetrain", user: "" };
}

export function mapRaid(d: Raid): AlertContext {
  return {
    type: "raid",
    user: d.fromBroadcasterUserName,
    amount: d.viewers,
  };
}

export function mapStreamOnline(_d: StreamOnline): AlertContext {
  return { type: "stream_online", user: "" };
}
