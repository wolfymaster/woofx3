import { errorMessage, type Logger } from "../../../host/deps";
import type { EventPublisher } from "../types";

/** What publishing an event needs from the adapter's context. */
export interface PublishTarget {
  messageBus: EventPublisher;
  logger: Logger;
}

/**
 * Publishes one Twitch event and logs a failure instead of rejecting. Events
 * come from EventSub callbacks and timers, which have nobody to hand an error
 * to, and a lost event is not worth stopping the adapter for. Never rejects.
 */
export async function publishEvent(target: PublishTarget, [subject, data]: [string, Uint8Array]): Promise<void> {
  try {
    await target.messageBus.publish(subject, data);
  } catch (err) {
    target.logger.error("twitch: failed to publish an event; it is dropped", { subject, err: errorMessage(err) });
  }
}
