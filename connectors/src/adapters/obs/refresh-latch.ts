import type { ObsBrowserSourceRefresh } from "@woofx3/common/cloudevents/Obs/commands";

/**
 * How many consumed boot ids the latch remembers. sceneManager stops asking
 * once a request is accepted, so a repeat only comes from a reply lost on the
 * way back; that repeat arrives within seconds, long before sixteen newer
 * boots could push its id out.
 */
export const REFRESH_LATCH_CONSUMED_CAPACITY = 16;

/** What became of a request handed to `latch`. */
export type LatchOutcome = "latched" | "repeat";

/**
 * The overlay refresh sceneManager asked for, held until an OBS session acts
 * on it. Lives in the OBS adapter's host state, so a request made while the
 * adapter is stopped, parked or restarting waits for the next run instead of
 * being lost.
 *
 * A refresh recovers overlays after sceneManager restarted; after a mere OBS
 * reconnect their streams are intact, and a refresh would cut off whatever is
 * playing. So each boot id refreshes at most once, and only a request, never
 * a connection, arms one.
 */
export class RefreshLatch {
  private pending: ObsBrowserSourceRefresh | null = null;
  /** Taken by a session and not yet consumed or handed back. */
  private inFlight: ObsBrowserSourceRefresh | null = null;
  /** Insertion-ordered, so the oldest id is the first evicted. */
  private readonly consumed = new Set<string>();
  private listener: (() => void) | null = null;

  /**
   * Holds the request, replacing an older one still waiting. A boot id that is
   * waiting, being refreshed or already consumed changes nothing.
   */
  latch(request: ObsBrowserSourceRefresh): LatchOutcome {
    const { bootId } = request;
    if (this.consumed.has(bootId) || this.pending?.bootId === bootId || this.inFlight?.bootId === bootId) {
      return "repeat";
    }
    this.pending = request;
    this.listener?.();
    return "latched";
  }

  /** Hands the waiting request to a session, or null when none waits. At most one is taken at a time. */
  take(): ObsBrowserSourceRefresh | null {
    if (this.inFlight !== null || this.pending === null) {
      return null;
    }
    this.inFlight = this.pending;
    this.pending = null;
    return this.inFlight;
  }

  /** OBS refreshed for the taken request: its boot id never refreshes again. */
  consume(request: ObsBrowserSourceRefresh): void {
    this.assertTaken(request);
    this.inFlight = null;
    this.consumed.add(request.bootId);
    if (this.consumed.size > REFRESH_LATCH_CONSUMED_CAPACITY) {
      const [oldest] = this.consumed;
      if (oldest !== undefined) {
        this.consumed.delete(oldest);
      }
    }
  }

  /**
   * OBS was never asked: the taken request waits again, unless a newer one
   * arrived meanwhile. The listener hears of it, since the run that took it
   * may have been stopped and another started in between.
   */
  release(request: ObsBrowserSourceRefresh): void {
    this.assertTaken(request);
    this.inFlight = null;
    this.pending ??= request;
    this.listener?.();
  }

  /**
   * Calls `listener` whenever a request is latched; one listener at a time,
   * the running adapter's. Returns the call that removes it.
   */
  onLatched(listener: () => void): () => void {
    if (this.listener !== null) {
      throw new Error("the refresh latch already has a listener; only one OBS adapter run holds it");
    }
    this.listener = listener;
    return () => {
      if (this.listener === listener) {
        this.listener = null;
      }
    };
  }

  private assertTaken(request: ObsBrowserSourceRefresh): void {
    if (this.inFlight !== request) {
      throw new Error(`the refresh for boot ${request.bootId} was not taken from the latch`);
    }
  }
}
