import type { HelixUser } from "@twurple/api";
import type EventFactory from "@woofx3/common/cloudevents/EventFactory";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";

export interface Context {
  broadcaster: HelixUser;
  logger: SharedLogger;
  messageBus: NATSClient;
  events: EventFactory;
}

export interface TwitchContext {
  apiUrl: string;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  logger: SharedLogger;
}

export interface TwitchApiRequestMessage {
  command: string;
  args: Record<string, string>;
}

export type HandlerResponse<T> = SuccessHandlerResponse<T> | ErrorHandlerResponse<T>;

export type SuccessHandlerResponse<T> = {
  error: false;
  payload?: T;
};

export type ErrorHandlerResponse<T> = {
  error: true;
  errorMsg: string;
};
