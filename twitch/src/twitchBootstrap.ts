import { AccessTokenWithUserId, RefreshingAuthProvider } from '@twurple/auth';
import { GetUserToken } from './coredb.pb';

type BootstrapArgs = {
    databaseURL: string;
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
        const response = await GetUserToken({ username: channel }, { 
            baseURL: args.databaseURL,
        });
        const token: AccessTokenWithUserId = JSON.parse(response.token);
        await authProvider.addUserForToken(token, ['chat']);
    } catch(err) {
        console.error("rpc failed: ", err);
    }

    return authProvider;
}
