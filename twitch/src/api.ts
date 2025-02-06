/// i need to setup something to listen to twitch events

import { RefreshingAuthProvider } from '@twurple/auth';
import { ApiClient } from '@twurple/api';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import { EventSubChannelFollowEvent } from '@twurple/eventsub-base';
import dotenv from 'dotenv';
import * as twitch from './lib';
import { type TwitchContext } from './types';
import NatsClient from './nats';
import Commands from './commands';


dotenv.config();

const clientId = process.env.TWITCH_WOLFY_CLIENT_ID || '';
const clientSecret = process.env.TWITCH_WOLFY_CLIENT_SECRET || '';

const bus = await NatsClient();

const logger = twitch.makeLogger({
    level: 'info',
    defaultMeta: { service: 'twitch' },
});

const authProvider = new RefreshingAuthProvider({
    clientId,
    clientSecret,
    redirectUri: `http://localhost`,
});
const token = await twitch.readTokenFromFile('./.wolfy_access_token');
await authProvider.addUserForToken(token);

const mockSubscriptionURL = 'http://localhost:8080/eventsub/subscriptions';

const apiClient = new ApiClient({ authProvider });
const listener = new EventSubWsListener({ apiClient });

let ctx: TwitchContext = {
    apiUrl: 'https://api.twitch.tv/helix/',
    clientId: process.env.TWITCH_WOLFY_CLIENT_ID || '',
    clientSecret: process.env.TWITCH_WOLFY_CLIENT_SECRET || '',
    accessToken: token.accessToken,
    logger,
};

try {
    const userId = await twitch.getBroadcasterId(ctx, 'wolfymaster');

    listener.onChannelBan(userId, (event) => {
        console.log(Commands.USER_BANNED, event);
    })

    listener.start();

    listener.onChannelFollow(userId, userId, (event: EventSubChannelFollowEvent) => {
        bus.publish('slobs', JSON.stringify({
            command: Commands.FOLLOW,
            args: { username: event.userName }
        }))
    });

    listener.onStreamOnline(userId, (event) => {
        console.log('event online', event);
    })

    listener.onChannelCheer(userId, evt => {
        console.log(Commands.BIT_CHEER, evt);
    });

    listener.onChannelHypeTrainBegin(userId, (data) => {
        bus.publish('slobs', JSON.stringify({
            command: Commands.HYPE_TRAIN_BEGIN,
            args: { }
        }))
    });

    listener.onChannelSubscription(userId, (event) =>{

    });

} catch (err) {
    console.error(err.message);
    process.exit(0);
}
