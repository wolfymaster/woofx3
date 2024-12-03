import { RefreshingAuthProvider, type AccessTokenWithUserId } from '@twurple/auth';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { ChatClient, ChatMessage, type ChatSayMessageAttributes } from '@twurple/chat';
import { Commands, makeSender, readTokenFromFile } from './lib';
import NatsClient from '../lib/nats';

dotenv.config();

const authProvider = new RefreshingAuthProvider({
    clientId: process.env.TWITCH_WOLFY_CLIENT_ID || "",
    clientSecret: process.env.TWITCH_WOLFY_CLIENT_SECRET || "",
    redirectUri: `http://localhost`,
});

authProvider.onRefresh(([userId, token]) => {
    console.log('refreshing token for: ', userId);
});

authProvider.onRefreshFailure(([userId, error]) => {
    console.log('failed to refresh token for: ', userId);
    console.error(error);
});

let channel = 'wolfymaster';

const token = await readTokenFromFile('./.wolfy_access_token');
await authProvider.addUserForToken(token, ['chat']);
const bus = await NatsClient();

const chatClient = new ChatClient({ authProvider, channels: [channel] });
chatClient.connect();
console.log(chalk.yellow('#######################################################'));
console.log(chalk.yellow.bold(`Connected to Twitch chat for channel: ${channel}`));
console.log(chalk.yellow('####################################################### \n'));

const send = makeSender(chatClient, channel);
const commander = new Commands();

commander.add('woof', 'woofwoof');

commander.add('so', async (text: string) => {
    // sent request for shoutout with username
    const username = text.slice(1); // need to look for and remove @ sign

    bus.publish('slobs', JSON.stringify({
        command: 'shoutout',
        args: { username }
    }));

    return '';
})

chatClient.onMessage(async (channel: string, user: string, text: string, msg: ChatMessage) => {
    let [message, matched] = await commander.process(text);

    if(matched && message) {
        await send(message);
    }
});