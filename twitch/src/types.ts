import { Logger } from 'winston';

export interface Context {
    logger: Logger;
}

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

export type HandlerResponse<T> = SuccessHandlerResponse<T> | ErrorHandlerResponse<T>;

export type SuccessHandlerResponse<T> = {
    error: false;
    payload?: T;
}

export type ErrorHandlerResponse<T> = {
    error: true;
    errorMsg: string;
}