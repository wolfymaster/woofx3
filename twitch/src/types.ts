import { Logger } from 'winston';

export interface TwitchContext {
    apiUrl: string;
    clientId: string;
    clientSecret: string;
    accessToken: string;
    logger: Logger;
}

export interface TwitchApiRequestMessage {
    command: string;
    args: Record<string, string>
}

export type HandlerResponse<T> = {
    error: boolean;
    errorMsg?: string;
    payload?: T;
}