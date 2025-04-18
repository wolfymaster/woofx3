import chalk from 'chalk';
import { AccessTokenWithUserId, RefreshingAuthProvider } from '@twurple/auth';
import { ChatClient, ChatMessage, ChatSayMessageAttributes } from '@twurple/chat';
import { Commands } from './commands';
import { GetBroadcasterToken } from '@client/user.pb';

type SenderFunction = (msg: string, opts?: ChatSayMessageAttributes) => Promise<void>;

type BootstrapArgs = {
    databaseURL: string;
}

export default async function bootstrap(channel: string, commander: Commands, args: BootstrapArgs): Promise<(msg: string, opts?: ChatSayMessageAttributes, parseCommand?: boolean) => Promise<void>> {
    const authProvider = new RefreshingAuthProvider({
        clientId: process.env.TWITCH_WOLFY_CLIENT_ID || "",
        clientSecret: process.env.TWITCH_WOLFY_CLIENT_SECRET || "",
        redirectUri: process.env.TWITCH_REDIRECT_URL || "http://localhost",
    });
    
    authProvider.onRefresh(([userId, token]) => {
        console.log('refreshing token for: ', userId);
    });
    
    authProvider.onRefreshFailure(([userId, error]) => {
        console.log('failed to refresh token for: ', userId);
        console.error(error);
    });
    
    // call db service to lookup token for user
    try {
        const response = await GetBroadcasterToken({ broadcasterId: process.env.TWITCH_BROADCASTER_ID || '' }, { 
            baseURL: args.databaseURL,
        });
        const token: AccessTokenWithUserId = JSON.parse(response.token);
        await authProvider.addUserForToken(token, ['chat']);
    } catch(err) {
        console.error("rpc failed: ", err);
    }

    // create Twitch chat client
    const chatClient = new ChatClient({ authProvider, channels: [channel] });
    // connect client
    chatClient.connect();
   
    console.log(chalk.yellow('#######################################################'));
    console.log(chalk.yellow.bold(`Connected to Twitch chat for channel: ${channel}`));
    console.log(chalk.yellow('####################################################### \n'));
    
    const send = makeSender(chatClient, channel);

    chatClient.onMessage(async (channel: string, user: string, text: string, msg: ChatMessage) => {
        let [message, matched] = await commander.process(text, user);
    
        if(matched && message) {
            await send(message);
        }
    });

    return async (msg: string, opts: ChatSayMessageAttributes = {}, parseCommand = true) => {
        if(parseCommand) {
            let [message, matched] = await commander.process(msg, channel);
            send(message);
        } else {
            send(msg);
        }
    };
}

function makeSender(client: ChatClient, channel: string): SenderFunction {
    return async (msg: string, opts?: ChatSayMessageAttributes) => {
        console.log(chalk.yellow('sending: '), msg);
        await client.say(channel, msg, opts);
    }
}
