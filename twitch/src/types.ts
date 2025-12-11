import { HelixUser } from '@twurple/api';
import { Logger } from 'winston';
import MessageBus from '@woofx3/messagebus';
import EventFactory from '@woofx3/cloudevents/EventFactory'

export interface Context {
    broadcaster: HelixUser;
    logger: Logger;
    messageBus: MessageBus.MessageBus;
    events: EventFactory;
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