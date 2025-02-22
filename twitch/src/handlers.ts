import { ApiClient, HelixChatChatter, HelixPaginatedResultWithTotal } from "@twurple/api";
import { HandlerResponse } from "./types";

export async function getChatters(apiClient: ApiClient): Promise<HandlerResponse<HelixPaginatedResultWithTotal<HelixChatChatter>>> {
    const broadcaster = await apiClient.users.getUserByName(process.env.TWITCH_CHANNEL_NAME || "");
    if (!broadcaster) {
        return { error: true, errorMsg: 'could not get broadcaster' };
    }
    const chatters = await apiClient.chat.getChatters(broadcaster);
    return success(chatters);
}

export async function updateStream(apiClient: ApiClient, args: { category?: string, title?: string }): Promise<HandlerResponse<void>> {
    const broadcaster = await apiClient.users.getUserByName(process.env.TWITCH_CHANNEL_NAME || "");

    if(!broadcaster) {
        return error('could not get broadcaster');
    }

    // update stream category
    if(args.category) {
        const game = await apiClient.games.getGameByName(args.category);

        if(!game) {
            return error('did not match any games');
        }   
    
        await apiClient.channels.updateChannelInfo(broadcaster, {
            gameId: game.id,
        });
    }

    // update stream title
    if(args.title) {
        await apiClient.channels.updateChannelInfo(broadcaster, {
            title: args.title
        });
    }

    return success();
}

function error(errorMsg: string) {
    return { error: true, errorMsg };
}

function success<T>(payload?: T) {
    if(!payload) {
        return { error: false };
    }
    
    return { error: false, payload };
}