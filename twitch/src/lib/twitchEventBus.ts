import { EventSubWsListener } from '@twurple/eventsub-ws';
import { EventSubSubscription } from '@twurple/eventsub-base'

import onChannelBan from './subscriptions/onChannelBan';
import onChannelChatmessage from './subscriptions/onChannelChatMessage';
import onChannelCheer from './subscriptions/onChannelCheer';
import onChannelFollow from './subscriptions/onChannelFollow';
import onChannelHypeTrainBegin from './subscriptions/onChannelHypeTrainBegin';
import onChannelSubscription from './subscriptions/onChannelSubscription';
import onChannelSubscriptionGift from './subscriptions/onChannelSubscriptionGift';
import onStreamOnline from './subscriptions/onStreamOnline';

import { Context } from 'src/types';

export default class TwitchEventBus {
    private subscriptions: EventSubSubscription[]
    private autoReconnect: boolean;

    constructor(private ctx: Context, private listener: EventSubWsListener) {
        this.subscriptions = [];
        this.listener = listener;
        this.autoReconnect = true;
    }

    connect(): void {
        this.listener.onUserSocketDisconnect(() => {
            if(this.autoReconnect) {
                this.listener.start();
            }
        });

        this.listener.start();
        this.ctx.logger.info("User Socket Connected");
    }

    disconnect(): void {
        this.autoReconnect = false;
        this.listener.stop();        
    }

    subscribe() {
        const funcs = [
            onChannelBan,
            onChannelChatmessage,
            onChannelCheer,
            onChannelFollow,
            onChannelHypeTrainBegin,
            onChannelSubscription,
            onChannelSubscriptionGift,
            onStreamOnline
        ];

        for (const f of funcs) {
            this.ctx.logger.info("Adding subscription", { subscription: f.name })
            this.subscriptions.push(f(this.ctx, this.listener));
        }
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