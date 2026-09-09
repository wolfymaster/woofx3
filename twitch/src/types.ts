import type { HelixUser } from "@twurple/api";
import type EventFactory from "@woofx3/common/cloudevents/EventFactory";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { ChatterMembershipEnricher } from "./lib/chatterMembership";

export interface Context {
  broadcaster: HelixUser;
  logger: SharedLogger;
  messageBus: NATSClient;
  events: EventFactory;
  /**
   * Fills in the membership fields Twitch does not stamp on a message.
   * Optional: enrichment is switched off by config, and a chat message
   * publishes fine without it - the unresolved fields are simply absent.
   */
  membershipEnricher?: ChatterMembershipEnricher;
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

export type HandlerResponse<T> = SuccessHandlerResponse<T> | ErrorHandlerResponse;

export type SuccessHandlerResponse<T> = {
  error: false;
  payload?: T;
};

export type ErrorHandlerResponse = {
  error: true;
  errorMsg: string;
};
