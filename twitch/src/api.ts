import dotenv from 'dotenv';
import path from 'path';
import { ApiClient, HelixUser } from '@twurple/api';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import { EventSubChannelCheerEvent, EventSubChannelBanEvent, EventSubChannelFollowEvent, EventSubChannelRedemptionAddEvent, EventSubChannelSubscriptionEvent, EventSubChannelSubscriptionGiftEvent } from '@twurple/eventsub-base';
import * as twitch from './lib';
import { type TwitchContext, TwitchApiRequestMessage } from './types';
import NatsClient, { natsMessageHandler } from './nats';
import TwitchBootstrap from './twitchBootstrap';
import Commands from './commands';
import * as Handlers from './handlers';
import { CreateUserEvent } from '@client/event.pb';

dotenv.config({
    path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../', '.env')],
});

// logger
const logger = twitch.makeLogger({
    level: 'info',
    defaultMeta: { service: 'twitch' },
});

let channel = process.env.TWITCH_CHANNEL_NAME;
if (!channel) {
    throw new Error('twitch channel missing. please set environment variable: TWITCH_CHANNEL_NAME.')
}

// bootstrap twitch auth provider
const authProvider = await TwitchBootstrap(channel, {
    databaseURL: process.env.DATABASE_PROXY_URL || "",
});

// Message Bus
const bus = await NatsClient();

const mockSubscriptionURL = 'http://localhost:8080/eventsub/subscriptions';

const apiClient = new ApiClient({ authProvider });
const listener = new EventSubWsListener({ apiClient });

const broadcaster = await apiClient.users.getUserByName({ name: process.env.TWITCH_CHANNEL_NAME || '' });
if (!broadcaster) {
    throw new Error('unable to resolve broadcaster');
}

console.log(`===================== STARTING TWITCH ===========================  `);

const chatMessagesQueue = [];

// let ctx: TwitchContext = {
//     apiUrl: 'https://api.twitch.tv/helix/',
//     clientId: process.env.TWITCH_WOLFY_CLIENT_ID || '',
//     clientSecret: process.env.TWITCH_WOLFY_CLIENT_SECRET || '',
//     accessToken: token.accessToken,
//     logger,
// };


const twitchApiMessageHandlerWithBroadcaster = (command: string, args: Record<string, string>) => {
    return twitchApiMessageHandler(command, args, broadcaster)
}

// listen on the eventbus for api calls
(async () => {
    for await (const msg of bus.subscribe('twitchapi')) {
        natsMessageHandler<TwitchApiRequestMessage>(msg, twitchApiMessageHandlerWithBroadcaster);
    }
})();

try {
    const userId = broadcaster.id;

    console.log('userId', userId);

    listener.onChannelBan(userId, (event: EventSubChannelBanEvent) => {
        let { reason, isPermanent, userDisplayName, userId  } = event;

        console.log(Commands.USER_BANNED, reason, isPermanent, userDisplayName, userId );
    });

    listener.onChannelFollow(userId, userId, async (event: EventSubChannelFollowEvent) => {
        const { followDate, userDisplayName, userId } = event;
        try {
            await CreateUserEvent({
                event: {
                    userId,
                    displayName: userDisplayName,
                    eventType: Commands.USER_FOLLOW,
                    follow: {
                        followDate: followDate.toISOString(),
                    }
                }
            }, {
                baseURL: process.env.DATABASE_PROXY_URL || "",
            });
        } catch(err) {
            console.error(err);
        }

        bus.publish('slobs', JSON.stringify({
            command: 'alert_message',
            args: { 
                audioUrl: 'https://streamlabs.local.woofx3.tv/pleasure.mp3',
                mediaUrl: 'https://media.tenor.com/LdHGHWDh0Y8AAAPo/look-at-you-i-see-you.mp4',
                text: `<3  {primary}${userDisplayName}{primary} followed <3`,
                duration: 6,
            }
        }))

        bus.publish('slobs', JSON.stringify({
            command: 'count', // TODO: Is there a better name?
            args: {
                id: 'ac39613d-4f48-459c-9f4e-6f3fb0df65e0',
                value: 1,
            }
        }))
    });

    listener.onStreamOnline(userId, (event: any) => {
        console.log('event online', event);

        // Reset Daily Sub Count
        bus.publish('slobs', JSON.stringify({
            command: 'count', // TODO: Is there a better name?
            args: {
                id: 'a2e8385b-5688-4ec2-92a1-f4bf3e3d53a4',
                reset: true,
            }
        }))

        // Reset Daily Follow Count
        bus.publish('slobs', JSON.stringify({
            command: 'count', // TODO: Is there a better name?
            args: {
                id: 'ac39613d-4f48-459c-9f4e-6f3fb0df65e0',
                reset: true,
            }
        }))
    })

    listener.onChannelCheer(userId, async (evt: EventSubChannelCheerEvent) => {
        console.log(Commands.BIT_CHEER, evt.bits, evt.message);

        const { message, bits, isAnonymous, userDisplayName, userId } = evt;

        if(!isAnonymous && userId) {
            try {
                await CreateUserEvent({
                    event: {
                        userId,
                        displayName: userDisplayName || '',
                        eventType: Commands.BIT_CHEER,
                        bitCheer: {
                            amount: bits,
                        }
                    }
                }, {
                    baseURL: process.env.DATABASE_PROXY_URL || "",
                });
            } catch(err) {
                console.error(err);
            }
            
        } else {
            console.log('assuming this was an annonymous cheer?', message, userDisplayName, userId);
        }

        bus.publish('reward', JSON.stringify({
            type: Commands.REWARD.BITS,
            payload: {
                message,
                bits,
                isAnonymous,
                userDisplayName,
                userId,
            }
        }))
    });

    listener.onChannelHypeTrainBegin(userId, (data: any) => {
        bus.publish('slobs', JSON.stringify({
            command: Commands.HYPE_TRAIN_BEGIN,
            args: {}
        }))
    });

    listener.onChannelSubscriptionGift(userId, async (evt: EventSubChannelSubscriptionGiftEvent) => {
        const { gifterId, gifterDisplayName, amount, tier, isAnonymous } = evt;

        console.log(Commands.USER_GIFT_SUBSCRIPTION, gifterDisplayName, amount, tier, isAnonymous);

        try {
            await CreateUserEvent({
                event: {
                    userId,
                    displayName: gifterDisplayName,
                    eventType: Commands.USER_GIFT_SUBSCRIPTION,
                    // TODO: Add gift subscription event
                }
            }, {
                baseURL: process.env.DATABASE_PROXY_URL || "",
            });
        } catch(err) {
            console.error(err);
        }

        const suborsubs = amount > 1 ? 'subscriptions': 'subscription';

        bus.publish('slobs', JSON.stringify({
            command: 'alert_message',
            args: { 
                audioUrl: 'https://streamlabs.local.woofx3.tv/allinthistogether.mp3',
                mediaUrl: 'https://media.tenor.com/MojW2yr1vFoAAAPo/money-money-money.mp4',
                text: `$$ {primary}${gifterDisplayName}{primary} gifted {primary}${amount}{primary} ${suborsubs} $$`,
            }
        }));

        bus.publish('slobs', JSON.stringify({
            command: 'count', // TODO: Is there a better name?
            args: {
                id: 'a2e8385b-5688-4ec2-92a1-f4bf3e3d53a4',
                value: amount,
            }
        }))
    })

    listener.onChannelSubscription(userId, async (event: EventSubChannelSubscriptionEvent) => {
        const { userId, userDisplayName, isGift, tier } = event;

        console.log(Commands.USER_SUBSCRIBE, userDisplayName, tier, isGift);

        try {
            await CreateUserEvent({
                event: {
                    userId,
                    displayName: userDisplayName,
                    eventType: Commands.USER_SUBSCRIBE,
                    subscribe: {
                        gift: isGift,
                        tier,
                    }
                }
            }, {
                baseURL: process.env.DATABASE_PROXY_URL || "",
            });
        } catch(err) {
            console.error(err);
        }

        if(!isGift) {
            bus.publish('slobs', JSON.stringify({
                command: 'alert_message',
                args: { 
                    audioUrl: 'https://streamlabs.local.woofx3.tv/wolf-hype.mp3',
                    mediaUrl: 'https://media.tenor.com/bj2uMQRTdSEAAAPo/dog-husky.mp4',
                    text: `<3  {primary}${userDisplayName}{primary} subscribed <3`,
                }
            }));

            bus.publish('slobs', JSON.stringify({
                command: 'count', // TODO: Is there a better name?
                args: {
                    id: 'a2e8385b-5688-4ec2-92a1-f4bf3e3d53a4',
                    value: 1,
                }
            }))
        }
    });

    listener.onChannelRedemptionAdd(userId, async (evt: EventSubChannelRedemptionAddEvent) => {
        const { rewardId, rewardCost, rewardPrompt, rewardTitle, userId, userDisplayName, input } = evt;

        switch(rewardId) {
            case '7e9e40e6-1ee4-43ec-be38-252bec1f89d4':
                try {
                    const response = await fetch('https://api.console.tts.monster/generate', {
                        method: 'POST',
                        headers: {
                            authorization: process.env.TTSMONSTER_API_TOKEN || ''
                        },
                        body: JSON.stringify({
                            "voice_id": "114554e2-caa8-4377-b611-626539f3d25e",
                            "message": input
                        })
                    });
    
                    const data = await response.json();
    
                    bus.publish('slobs', JSON.stringify({
                        command: 'alert_message',
                        args: { 
                            audioUrl: data.url,
                            // mediaUrl: 'https://media.tenor.com/LdHGHWDh0Y8AAAPo/look-at-you-i-see-you.mp4',
                            // text: `{primary}${userDisplayName}{primary} followed <3`,
                            // duration: 6,
                        }
                    }))    
                } catch (err) {
                    console.error(err);
                }
                
            break;

            case '42c021b1-5ed3-4ff4-9c38-d8a3ec50867f': 
                console.log('generating complement for: ', userDisplayName);
                // go get a complement
                const complement = await Handlers.complement(apiClient, { user: userDisplayName });
                
                console.log('generated complement: ', complement);

                const response = await fetch('https://api.console.tts.monster/generate', {
                    method: 'POST',
                    headers: {
                        authorization: process.env.TTSMONSTER_API_TOKEN || ''
                    },
                    body: JSON.stringify({
                        "voice_id": "114554e2-caa8-4377-b611-626539f3d25e",
                        "message": complement
                    })
                });

                const data = await response.json();

                console.log('received data: ', data)

                bus.publish('slobs', JSON.stringify({
                    command: 'alert_message',
                    args: { 
                        audioUrl: data.url,
                    }
                }));
            break;
            default:
                console.log('nothing to do for rewardId: ', rewardId)
        }

        console.log( rewardId, rewardCost, rewardPrompt, rewardTitle, userId, userDisplayName, input)
    });

    listener.start();
    console.log('listener started');

} catch (err: any) {
    console.error(err.message);
    process.exit(0);
}

async function twitchApiMessageHandler(command: string, args: Record<string, string>, broadcaster: HelixUser) {
    console.log('twitchapi', command, args);

    const handlers = {
        chatters: () => Handlers.getChatters(apiClient),
        update_stream: () => Handlers.updateStream(apiClient, args),
        moderate: () => Handlers.moderate(apiClient, args, chatMessagesQueue),
        chatMessage: () => Handlers.chatMessage(chatMessagesQueue, args),
        timeout: () => Handlers.timeoutUser(apiClient, args, broadcaster),
        shoutout: () => Handlers.shoutoutUser(apiClient, args, broadcaster),
        userinfo: () => Handlers.userInfo(apiClient, args, broadcaster),
    }

    const handler = handlers[command];

    if(!handler) {
        console.log(`${command} is not a valid command`);
        return;
    }

    const result = await handler();

    console.log('recived result: ', result);

    if(result.error) {
        console.log(handler.errorMsg);
        return;
    }

    // if a command was returned, we want to reprocess
    if(result.command) {
        await twitchApiMessageHandler(result.command, result.args, broadcaster);
    }
}
