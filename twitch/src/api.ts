/// i need to setup something to listen to twitch events

import { RefreshingAuthProvider } from '@twurple/auth';
import { ApiClient } from '@twurple/api';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import { EventSubChannelFollowEvent } from '@twurple/eventsub-base';
import dotenv from 'dotenv';
import * as twitch from './lib';
import { type TwitchContext } from './types';
import NatsClient from './nats';


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
        console.log('banned', event);
    })

    listener.start();

    listener.onChannelFollow(userId, userId, (event: EventSubChannelFollowEvent) => {
        bus.publish('slobs', JSON.stringify({
            command: 'follow',
            args: { username: event.userName }
        }))
    });

    listener.onStreamOnline(userId, (event) => {
        console.log('event online', event);
    })

    listener.onChannelCheer(userId, evt => {
        console.log('onchannelcheer', evt);
    });

    listener.onChannelHypeTrainBegin(userId, (data) => {

    });

    listener.onChannelSubscription(userId, (event) =>{

    });

} catch (err) {
    console.error(err.message);
    process.exit(0);
}
