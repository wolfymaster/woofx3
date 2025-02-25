import dotenv from 'dotenv';
import path from 'path';
import { ApiClient } from '@twurple/api';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import { EventSubChannelFollowEvent } from '@twurple/eventsub-base';
import * as twitch from './lib';
import { type TwitchContext, TwitchApiRequestMessage } from './types';
import NatsClient, { natsMessageHandler } from './nats';
import TwitchBootstrap from './twitchBootstrap';
import Commands from './commands';
import * as Handlers from './handlers';
import { CreateUserChatMessage, CreateUserEvent } from '@client/coredb.pb';

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

    listener.onChannelFollow(userId, userId, (event: EventSubChannelFollowEvent) => {
        bus.publish('slobs', JSON.stringify({
            command: Commands.FOLLOW,
            args: { username: event.userName }
        }))
    });

    listener.onStreamOnline(userId, (event: any) => {
        console.log('event online', event);
    })

    listener.onChannelCheer(userId, async (evt: any) => {
        console.log(Commands.BIT_CHEER, evt);

        const { message, bits, isAnonymous, userDisplayName, userId } = evt;

        if(!isAnonymous && userId) {
            await CreateUserEvent({ 
                user: {
                    userId,
                    displayName: userDisplayName,
                },
                event: {
                    eventType: Commands.BIT_CHEER,
                    eventValue: `${bits}`
                }
            });
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

    listener.onChannelSubscription(userId, (event: any) => {

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


