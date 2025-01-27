import dotenv from 'dotenv';
import path from 'path';
import NatsClient from './nats';
import TwitchBootstrap from './twitchBootstrap';
import { Commands } from './commands';

dotenv.config({
    path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../', '.env')],
});

let channel = process.env.TWITCH_CHANNEL_NAME;
if(!channel) {
    throw new Error('twitch channel missing. please set environment variable: TWITCH_CHANNEL_NAME.')
}

// new Commands instance
const commander = new Commands();

// bootstrap twitch auth provider
await TwitchBootstrap(channel, commander, {
    databaseURL: process.env.DATABASE_PROXY_URL || "",
});
// create NATS client
const bus = await NatsClient();

commander.add('woof', 'woofwoof');

commander.add('so', async (text: string) => {
    // sent request for shoutout with username
    const username = text.replace('@', '').trim();

    console.log(username);

    bus.publish('slobs', JSON.stringify({
        command: 'shoutout',
        args: { username }
    }));

    return '';
})

commander.add('follow', async (text: string) => {
    // sent request for shoutout with username
    const username = text.replace('@', '').trim();

    console.log(username);

    bus.publish('slobs', JSON.stringify({
        command: 'follow',
        args: { username }
    }));

    return '';
})
