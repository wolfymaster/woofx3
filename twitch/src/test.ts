import dotenv from "dotenv";
import path from "path";
import { ApiClient, HelixEventSubSubscription, HelixUser } from "@twurple/api";
import { EventSubWsListener } from "@twurple/eventsub-ws";
import NatsClient, { natsMessageHandler } from "./nats";
import {
    EventSubChannelFollowEvent,
    EventSubChannelSubscriptionEvent,
    EventSubChannelSubscriptionGiftEvent,
} from "@twurple/eventsub-base";
import { CreateUserEvent } from "@client/event.pb";
import TwitchBootstrap from "./twitchBootstrap";

dotenv.config({
    path: [
        path.resolve(process.cwd(), ".env"),
        path.resolve(process.cwd(), "../", ".env"),
    ],
});

// bootstrap twitch auth provider
const authProvider = await TwitchBootstrap("wolfymaster", {
    databaseURL: process.env.DATABASE_PROXY_URL || "",
});

const apiClient = new ApiClient({ mockServerPort: 9002, authProvider });
const listener = new EventSubWsListener({
    url: "ws://127.0.0.1:9002/ws",
    apiClient,
});

// Message Bus
const bus = await NatsClient();

const userId = 118373299;

listener.onSubscriptionCreateSuccess(
    (evt: any, sub: HelixEventSubSubscription) => {
        console.log(
            "NOTE THIS ID - YOU NEED IT TO USE THE TWITCH CLI TO TRIGGER EVENTS",
        );
        console.log(sub.id, sub.type, sub.transportMethod);
    },
);

listener.onChannelFollow(
    userId,
    userId,
    async (event: EventSubChannelFollowEvent) => {
        const { followDate, userDisplayName, userId } = event;
        console.log(`triggered follow:`, userDisplayName);

        // publish the follow event to workflow
        bus.publish(
            "workflow.follow",
            JSON.stringify({
                type: "follow",
                payload: {
                    userDisplayName,
                },
            }),
        );
    },
);

listener.onChannelSubscription(
    userId,
    async (event: EventSubChannelSubscriptionEvent) => {
        const { userId, userDisplayName, isGift, tier } = event;

        console.log(
            "triggered channel subscription",
            userDisplayName,
            tier,
            isGift,
        );

        if (!isGift) {
            bus.publish(
                "slobs",
                JSON.stringify({
                    command: "alert_message",
                    args: {
                        audioUrl:
                            "https://streamlabs.local.woofx3.tv/wolf-hype.mp3",
                        mediaUrl:
                            "https://media.tenor.com/bj2uMQRTdSEAAAPo/dog-husky.mp4",
                        text:
                            `<3  {primary}${userDisplayName}{primary} subscribed <3`,
                    },
                }),
            );
        }
    },
);

listener.onChannelSubscriptionGift(
    userId,
    async (evt: EventSubChannelSubscriptionGiftEvent) => {
        const { gifterId, gifterDisplayName, amount, tier, isAnonymous } = evt;

        const gifterName = isAnonymous ? 'Anonymoose' : gifterDisplayName;

        console.log(
            "triggered gifted subscription",
            gifterDisplayName,
            amount,
            tier,
            isAnonymous,
        );

        const suborsubs = amount > 1 ? "subscriptions" : "subscription";

        bus.publish(
            "workflow.subscription",
            JSON.stringify({
                type: "subscription",
                payload: {
                    audioUrl:
                        "https://streamlabs.local.woofx3.tv/allinthistogether.mp3",
                    mediaUrl:
                        "https://media.tenor.com/MojW2yr1vFoAAAPo/money-money-money.mp4",
                    text:
                        `$$ {primary}${gifterName}{primary} gifted {primary}${amount}{primary} ${suborsubs} $$`,
                },
            }),
        );
    },
);

listener.start();
console.log("listener started");
