import { EventType } from "./Session/events";
import { setCurrentSessionId } from "./session";

/**
 * The slice of a NATS client this needs.
 *
 * Declared structurally rather than imported, because this package has no
 * dependencies and adding one to reach a single method would couple every
 * event producer to the bus client.
 */
export interface SessionBus {
  subscribe(subject: string, handler: (msg: { json(): unknown }) => void): Promise<unknown>;
}

/** Just enough logger to report a malformed announcement. */
export interface SessionSubscriberLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
}

/**
 * Keep this process's stamping holder current from the bus.
 *
 * Every service that publishes events needs this; without it `Event()` has no
 * session to stamp and the gap is invisible except for a one-time warning.
 *
 * Subscribes to `session.started` only. `session.ended` is the signal for
 * dropping state scoped to a finished session, not for forgetting which session
 * to stamp -- the resolver emits `ended` immediately followed by `started` for
 * the successor, so a subscriber that cleared on `ended` would publish
 * unstamped events in the gap between the two messages. A session is always
 * present, so the holder should never be empty once it has been filled.
 */
export async function subscribeToSessionUpdates(bus: SessionBus, logger?: SessionSubscriberLogger): Promise<void> {
  await bus.subscribe(EventType.SessionStarted, (msg) => {
    // A throw here kills the subscription and stops delivery of everything
    // behind it, so nothing in this handler is allowed to escape.
    const sessionId = readSessionId(msg);
    if (sessionId === null) {
      logger?.warn("session.started: no sessionId in payload; keeping the previous session");
      return;
    }
    setCurrentSessionId(sessionId);
    logger?.info("Stamping events with a new stream session", { sessionId });
  });
}

function readSessionId(msg: { json(): unknown }): string | null {
  try {
    const envelope = msg.json() as Record<string, unknown>;
    // `ce.data ?? ce` is how every consumer in the repo unwraps an envelope;
    // nothing validates CloudEvents on the way in.
    const data = ((envelope.data as Record<string, unknown> | undefined) ?? envelope) as Record<string, unknown>;
    const sessionId = data.sessionId;
    if (typeof sessionId !== "string" || sessionId === "") {
      return null;
    }
    return sessionId;
  } catch {
    return null;
  }
}
