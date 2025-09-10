import chalk from 'chalk';
import { AccessTokenWithUserId, RefreshingAuthProvider } from '@twurple/auth';
import { ChatClient, ChatMessage, ChatSayMessageAttributes } from '@twurple/chat';
import { Commands } from './commands';
import { GetSetting } from '@client/setting.pb';

type SenderFunction = (msg: string, opts?: ChatSayMessageAttributes) => Promise<void>;

type BootstrapArgs = {
    databaseURL: string;
}

async function GetBroadcasterToken(dbUrl: string): Promise<AccessTokenWithUserId> {
    const response = await GetSetting({ 
        applicationId: process.env.APPLICATION_ID || "", 
        key: 'twitch_token'
    }, { baseURL: dbUrl });
    return JSON.parse(response.setting.value.stringValue || '') satisfies AccessTokenWithUserId;
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
        const token = await GetBroadcasterToken(args.databaseURL);
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
