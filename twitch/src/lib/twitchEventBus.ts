import type { EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import type { Context } from "src/types";
import onChannelBan from "./subscriptions/onChannelBan";
import onChannelChatmessage from "./subscriptions/onChannelChatMessage";
import onChannelCheer from "./subscriptions/onChannelCheer";
import onChannelFollow from "./subscriptions/onChannelFollow";
import onChannelHypeTrainBegin from "./subscriptions/onChannelHypeTrainBegin";
import onChannelSubscription from "./subscriptions/onChannelSubscription";
import onChannelSubscriptionGift from "./subscriptions/onChannelSubscriptionGift";
import onStreamOnline from "./subscriptions/onStreamOnline";

export default class TwitchEventBus {
  private subscriptions: EventSubSubscription[];
  private autoReconnect: boolean;
  private disconnectHandlerRegistered: boolean;

  constructor(
    private ctx: Context,
    private listener: EventSubWsListener
  ) {
    this.subscriptions = [];
    this.listener = listener;
    this.autoReconnect = true;
    this.disconnectHandlerRegistered = false;
  }

  connect(): void {
    this.autoReconnect = true;

    // if (!this.disconnectHandlerRegistered) {
    //   this.listener.onUserSocketDisconnect(() => {
    //     if (this.autoReconnect) {
    //       this.listener.start();
    //     }
    //   });
    //   this.disconnectHandlerRegistered = true;
    // }

    this.listener.start();
    this.ctx.logger.info("User Socket Connected");
  }

  disconnect(): void {
    this.autoReconnect = false;
    this.clearSubscriptions();
    this.listener.stop();
  }

  subscribe() {
    this.clearSubscriptions();

    const funcs = [
      onChannelBan,
      onChannelChatmessage,
      onChannelCheer,
      onChannelFollow,
      onChannelHypeTrainBegin,
      onChannelSubscription,
      onChannelSubscriptionGift,
      onStreamOnline,
    ];

    for (const f of funcs) {
      this.ctx.logger.info("Adding subscription", { subscription: f.name });
      this.subscriptions.push(f(this.ctx, this.listener));
    }
  }

  private clearSubscriptions(): void {
    for (const sub of this.subscriptions) {
      sub.stop();
    }
    this.subscriptions = [];
  }

  start() {
    for (const sub of this.subscriptions) {
      sub.start();
    }
  }

  stop() {
    for (const sub of this.subscriptions) {
      sub.stop();
    }
  }
}
