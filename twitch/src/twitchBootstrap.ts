import { AccessTokenWithUserId, RefreshingAuthProvider } from '@twurple/auth';
import { GetSetting } from '@client/setting.pb';

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

export default async function bootstrap(channel: string, args: BootstrapArgs): Promise<RefreshingAuthProvider> {
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
        const response = await GetBroadcasterToken(args.databaseURL);
        await authProvider.addUserForToken(response, ['chat']);
    } catch(err) {
        console.error("rpc failed: ", err);
    }

    return authProvider;
}
