/**
 * The stream session this process stamps its events with.
 *
 * Held at module scope because `Event()` is a pure function with no ambient
 * context, and stamping has to happen there: it is the one place every event
 * family routes through, and the alternative -- each factory stamping for
 * itself -- is exactly how `platform` ended up present on Twitch events and
 * missing from every other family.
 *
 * Each publishing process is responsible for keeping this current by
 * subscribing to `session.started` / `session.ended`. A process that never does
 * will emit events without a session, which is why reading an unset session
 * warns rather than passing silently.
 */

let currentSessionId: string | undefined;
let warnedAboutMissingSession = false;

/** Called by a process's `session.started` subscription. */
export function setCurrentSessionId(sessionId: string): void {
  currentSessionId = sessionId;
  warnedAboutMissingSession = false;
}

/**
 * Forget the current session. Also re-arms the missing-session warning, which
 * makes this the reset a test wants between cases.
 */
export function clearCurrentSessionId(): void {
  currentSessionId = undefined;
  warnedAboutMissingSession = false;
}

/**
 * The session to stamp, or undefined when this process does not know one.
 *
 * Warns once rather than throwing. Every publish in every service runs through
 * here, and events are legitimately published before the first `session.started`
 * arrives -- turning that startup window into an exception would trade a missing
 * attribute for a dead service. The warning is for the case that actually needs
 * finding: a process nobody ever wired up.
 */
export function getCurrentSessionId(): string | undefined {
  if (currentSessionId === undefined && !warnedAboutMissingSession) {
    warnedAboutMissingSession = true;
    console.warn(
      "[cloudevents] emitting events with no stream session; is this process subscribed to session.started?"
    );
  }
  return currentSessionId;
}
