import type { HelixUser } from "@twurple/api";
import type EventFactory from "@woofx3/common/cloudevents/EventFactory";
import type { Logger } from "../../host/deps";
import type { ChatterMembershipEnricher } from "./lib/chatterMembership";

/**
 * Where the adapter's events go. The adapter's scoped bus satisfies it, and
 * refuses any subject its manifest does not list.
 */
export interface EventPublisher {
  publish(subject: string, data: Uint8Array): Promise<void>;
}

export interface Context {
  broadcaster: HelixUser;
  logger: Logger;
  messageBus: EventPublisher;
  events: EventFactory;
  /**
   * Fills in the membership fields Twitch does not stamp on a message.
   * Optional: enrichment is switched off by config, and a chat message
   * publishes fine without it - the unresolved fields are simply absent.
   */
  membershipEnricher?: ChatterMembershipEnricher;
  /** Told when stream.online / stream.offline arrives, after it is published. */
  onStreamLiveChange?: (live: boolean) => void;
}
