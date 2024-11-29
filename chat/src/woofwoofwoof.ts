import { RefreshingAuthProvider, type AccessTokenWithUserId } from '@twurple/auth';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { ChatClient, ChatMessage, type ChatSayMessageAttributes } from '@twurple/chat';
import { Commands, makeSender, readTokenFromFile } from './lib';

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

const chatClient = new ChatClient({ authProvider, channels: [channel] });
chatClient.connect();
console.log(chalk.yellow('#######################################################'));
console.log(chalk.yellow.bold(`Connected to Twitch chat for channel: ${channel}`));
console.log(chalk.yellow('####################################################### \n'));

const send = makeSender(chatClient, channel);
const commander = new Commands();

commander.add('woof', 'woofwoof');

commander.add('so', 'SHOUTING OUT VERY LOUD')

chatClient.onMessage(async (channel: string, user: string, text: string, msg: ChatMessage) => {
    let [message, matched] = commander.process(text);

    if(matched) {
        await send(message);
    }
});