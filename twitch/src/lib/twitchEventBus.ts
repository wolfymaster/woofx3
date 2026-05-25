import type { EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import type { Context } from "src/types";
import onChannelBan from "./subscriptions/onChannelBan";
import onChannelChatmessage from "./subscriptions/onChannelChatMessage";
import onChannelCheer from "./subscriptions/onChannelCheer";
import onChannelFollow from "./subscriptions/onChannelFollow";
import onChannelHypeTrainBegin from "./subscriptions/onChannelHypeTrainBegin";
import onChannelRaid from "./subscriptions/onChannelRaid";
import onChannelRedemptionAdd from "./subscriptions/onChannelRedemptionAdd";
import onChannelSubscription from "./subscriptions/onChannelSubscription";
import onChannelSubscriptionGift from "./subscriptions/onChannelSubscriptionGift";
import onStreamOffline from "./subscriptions/onStreamOffline";
import onStreamOnline from "./subscriptions/onStreamOnline";

export default class TwitchEventBus {
  private subscriptions: EventSubSubscription[];

  constructor(
    private ctx: Context,
    private listener: EventSubWsListener
  ) {
    this.subscriptions = [];
    this.listener = listener;
  }

  /**
   * Start the EventSub WebSocket listener and register channel handlers.
   * Subscriptions activate when Twitch sends session_welcome (Twurple calls
   * subscription.start internally). Do not call subscription.start() during boot.
   */
  start(): void {
    this.listener.start();
    this.registerSubscriptions();
  }

  disconnect(): void {
    this.clearSubscriptions();
    this.listener.stop();
  }

  private registerSubscriptions(): void {
    this.clearSubscriptions();

    const funcs = [
      onChannelBan,
      onChannelChatmessage,
      onChannelCheer,
      onChannelFollow,
      onChannelHypeTrainBegin,
      onChannelRaid,
      onChannelRedemptionAdd,
      onChannelSubscription,
      onChannelSubscriptionGift,
      onStreamOnline,
      onStreamOffline,
    ];

    for (const f of funcs) {
      this.subscriptions.push(f(this.ctx, this.listener));
    }
  }

  private clearSubscriptions(): void {
    for (const sub of this.subscriptions) {
      sub.stop();
    }
    this.subscriptions = [];
  }

  /** Re-activate subscriptions after a manual stop(). Not used during initial boot. */
  resumeSubscriptions(): void {
    for (const sub of this.subscriptions) {
      sub.start();
    }
  }

  stopSubscriptions(): void {
    for (const sub of this.subscriptions) {
      sub.stop();
    }
  }
}
