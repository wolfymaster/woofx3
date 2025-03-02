import dotenv from 'dotenv';
import path from 'path';
import { ApiClient } from '@twurple/api';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import { EventSubChannelCheerEvent, EventSubChannelFollowEvent, EventSubChannelRedemptionAddEvent, EventSubChannelSubscriptionEvent } from '@twurple/eventsub-base';
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

// let ctx: TwitchContext = {
//     apiUrl: 'https://api.twitch.tv/helix/',
//     clientId: process.env.TWITCH_WOLFY_CLIENT_ID || '',
//     clientSecret: process.env.TWITCH_WOLFY_CLIENT_SECRET || '',
//     accessToken: token.accessToken,
//     logger,
// };

// listen on the eventbus for api calls
(async () => {
    for await (const msg of bus.subscribe('twitchapi')) {
        natsMessageHandler<TwitchApiRequestMessage>(msg, twitchApiMessageHandler);
    }
})();

try {
    const broadcaster = await apiClient.users.getUserByName({ name: process.env.TWITCH_CHANNEL_NAME || '' });
    if (!broadcaster) {
        throw new Error('unable to resolve broadcaster');
    }

    const userId = broadcaster.id;

    console.log('userId', userId);

    listener.onChannelBan(userId, (event: any) => {
        console.log(Commands.USER_BANNED, event);
    })

    listener.start();

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

    listener.onChannelSubscription(userId, (event: EventSubChannelSubscriptionEvent) => {

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
            default:
                console.log('nothing to do for rewardId: ', rewardId)
        }

        console.log( rewardId, rewardCost, rewardPrompt, rewardTitle, userId, userDisplayName, input)
    });

} catch (err: any) {
    console.error(err.message);
    process.exit(0);
}

async function twitchApiMessageHandler(command: string, args: Record<string, string>) {
    const handlers = {
        chatters: () => Handlers.getChatters(apiClient),
        update_stream: () => Handlers.updateStream(apiClient, args),
    }

    const handler = handlers[command];

    if(!handler) {
        console.log(`${command} is not a valid command`);
        return;
    }

    const result = await handler();

    if(result.error) {
        console.log(handler.errorMsg);
        return;
    }
}


