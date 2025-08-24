import { ApiClient, HelixUser } from "@twurple/api";

interface Command<T> {
    topic: string;
    command: string;
    args: T;
}

interface WriteMessageCommand {
    message: string;
}

export type CommandResponse<T = unknown> = {
    message?: string;
    error: boolean;
    command?: Command<T>;
};

export default class TwitchApi {
    constructor(private apiClient: ApiClient, private broadcaster: HelixUser) {}

    async clip(_args: unknown): Promise<CommandResponse<WriteMessageCommand>> {
        const clipId = await this.apiClient.clips.createClip({
            channel: this.broadcaster,
        });

        return {
            error: false,
            command: {
                topic: 'woofwoofwoof',
                command: "write_message",
                args: {
                    message: `https://clips.twitch.tv/${clipId}`,
                },
            },
        };
    }
}
