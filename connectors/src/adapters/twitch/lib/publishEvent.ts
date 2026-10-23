import { errorMessage, type Logger } from "../../../host/deps";
import type { EventPublisher } from "../types";

/** What publishing an event needs from the adapter's context. */
export interface PublishTarget {
  messageBus: EventPublisher;
  logger: Logger;
}

/** A built event: the subject it goes out on and its encoded CloudEvent. */
export type EventTuple = [subject: string, data: Uint8Array];

/**
 * Builds one Twitch event and publishes it, logging a failure of either step
 * instead of rejecting. Events come from EventSub callbacks and timers, which
 * have nobody to hand an error to, and a lost event is not worth stopping the
 * adapter for. Building goes through `build` so that a payload the event
 * factory refuses, or a Twurple getter that throws, is caught here too rather
 * than escaping the callback as an unhandled rejection. Never rejects.
 */
export async function publishEvent(
  target: PublishTarget,
  build: () => EventTuple | Promise<EventTuple>
): Promise<void> {
  let built: EventTuple;
  try {
    // A built tuple is used as is rather than awaited, so a synchronous build
    // reaches the bus before this call returns, as a plain publish would.
    const result = build();
    built = Array.isArray(result) ? result : await result;
  } catch (err) {
    target.logger.error("twitch: could not build an event; it is dropped", { err: errorMessage(err) });
    return;
  }
  const [subject, data] = built;
  try {
    await target.messageBus.publish(subject, data);
  } catch (err) {
    target.logger.error("twitch: failed to publish an event; it is dropped", { subject, err: errorMessage(err) });
  }
}
