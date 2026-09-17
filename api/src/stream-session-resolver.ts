import Event from "@woofx3/common/cloudevents/BaseEvent";
import { EventType as SessionEventType } from "@woofx3/common/cloudevents/Session/events";
import { setCurrentSessionId } from "@woofx3/common/cloudevents/session";
import { encode } from "@woofx3/common/cloudevents/utils";
import { EventType } from "@woofx3/common/cloudevents/Twitch/events";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import { DbError, type DbClient } from "./db-client";
import { timestampFromDate, timestampToIso } from "./routes/helpers";
import { decideOnStreamOnline } from "./stream-session-policy";

/**
 * Owns which stream session the system is in.
 *
 * `stream.online` and `stream.offline` are inputs to a decision rather than
 * boundaries: going live asks whether to extend the open session or start a new
 * one, and going offline only closes a segment within whichever session is
 * open. A session is always present, so this never has to answer "no session".
 *
 * The rule itself lives in `stream-session-policy.ts` and the storage in
 * db-proxy; this is the part that joins them to the bus. Everything else in the
 * system consumes `session.started` / `session.ended` and knows nothing about
 * grace windows.
 */
export class StreamSessionResolver {
  private sessionId: string | null = null;

  constructor(
    private nats: NATSClient,
    private db: DbClient,
    private applicationId: string,
    private logger: SharedLogger
  ) {}

  /** The session events should be stamped with, or null before `start()` resolved one. */
  currentSessionId(): string | null {
    return this.sessionId;
  }

  async start(): Promise<void> {
    // Returns the handler's promise rather than detaching it. Both handlers
    // swallow their own failures, so nothing can reject here; what this buys is
    // an observable completion instead of work that continues after the
    // subscription callback has already returned.
    await this.nats.subscribe(EventType.StreamOnline, (msg: Msg) => this.handleStreamOnline(msg));
    await this.nats.subscribe(EventType.StreamOffline, (msg: Msg) => this.handleStreamOffline(msg));

    // Resolve and announce before the first event arrives. A process that
    // restarted would otherwise publish unstamped until the next broadcast,
    // which on a quiet day is hours.
    await this.syncCurrentSession();

    this.logger.info("StreamSessionResolver started", {
      subjects: [EventType.StreamOnline, EventType.StreamOffline],
    });
  }

  private async syncCurrentSession(): Promise<void> {
    try {
      const state = await this.db.ensureCurrentStreamSession({ applicationId: this.applicationId });
      if (!state.session?.id) {
        this.logger.warn("StreamSessionResolver: no session resolved; events will publish unstamped");
        return;
      }
      await this.adoptSession(state.session.id, timestampToIso(state.session.startedAt));
    } catch (err) {
      this.logger.warn("StreamSessionResolver: could not resolve the current session", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleStreamOnline(msg: Msg): Promise<void> {
    try {
      const at = this.eventTime(msg);
      const state = await this.db.ensureCurrentStreamSession({ applicationId: this.applicationId });
      if (!state.session?.id) {
        this.logger.warn(`${EventType.StreamOnline}: no open stream session; skipping`);
        return;
      }

      const action = decideOnStreamOnline(
        {
          isSegmentOpen: state.isSegmentOpen === true,
          lastSegmentEndedAt: timestampToEpochMs(state.lastSegmentEndedAt),
        },
        at.getTime()
      );

      let sessionId = state.session.id;
      let endedSessionId: string | null = null;

      if (action === "split") {
        const split = await this.db.splitStreamSession({
          applicationId: this.applicationId,
          at: timestampFromDate(at),
        });
        if (!split.started?.id) {
          this.logger.error(`${EventType.StreamOnline}: split returned no successor session`);
          return;
        }
        endedSessionId = split.ended?.id || null;
        sessionId = split.started.id;
      }

      // Persist before announcing: a session event nobody can look up is worse
      // than a late one.
      await this.db.openStreamSessionSegment({
        applicationId: this.applicationId,
        streamSessionId: sessionId,
        startedAt: timestampFromDate(at),
      });

      if (endedSessionId) {
        await this.clearSessionScopedStorage(endedSessionId);
        await this.publish(SessionEventType.SessionEnded, {
          sessionId: endedSessionId,
          applicationId: this.applicationId,
          endedAt: at.toISOString(),
          replacedBySessionId: sessionId,
        });
      }
      if (this.sessionId !== sessionId) {
        await this.adoptSession(sessionId, at.toISOString());
      }
    } catch (err) {
      this.logger.error(`${EventType.StreamOnline}: stream session resolution failed`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleStreamOffline(msg: Msg): Promise<void> {
    try {
      // Only the segment closes. The session stays open and keeps stamping --
      // a stream that ends is not a session that ends, which is the whole
      // reason a dropout does not wipe session-scoped state.
      await this.db.closeStreamSessionSegment({
        applicationId: this.applicationId,
        endedAt: timestampFromDate(this.eventTime(msg)),
      });
    } catch (err) {
      if (err instanceof DbError && err.code === "not_found") {
        // A redelivered `stream.offline` finds no open segment because the
        // first one closed it. Not a fault.
        this.logger.debug(`${EventType.StreamOffline}: no open segment to close`);
        return;
      }
      this.logger.error(`${EventType.StreamOffline}: closing the segment failed`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async adoptSession(sessionId: string, startedAt: string): Promise<void> {
    this.sessionId = sessionId;
    // Feeds this process's own stamping holder. Every publishing process keeps
    // it current from these events; api/ is simply the one that emits them.
    setCurrentSessionId(sessionId);
    await this.publish(SessionEventType.SessionStarted, {
      sessionId,
      applicationId: this.applicationId,
      startedAt,
    });
  }

  /**
   * Drop the module storage the ended session owned.
   *
   * Runs before the announcement, so nothing reacting to `session.ended` can
   * read state that is about to disappear. A failure is logged and swallowed:
   * a boundary that could not clear is still a boundary, and refusing to
   * announce it would strand every other consumer over a storage fault.
   */
  private async clearSessionScopedStorage(endedSessionId: string): Promise<void> {
    try {
      const cleared = await this.db.clearSessionScoped({ applicationId: this.applicationId });
      this.logger.info("Cleared session-scoped module storage", { endedSessionId, cleared });
    } catch (err) {
      this.logger.error("Failed to clear session-scoped module storage", {
        endedSessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * When the broadcast actually changed state.
   *
   * Prefers the payload's own stamp over arrival time, so a delayed or
   * redelivered notification does not move a boundary that events have already
   * been stamped against. A stamp in the future is tolerated by
   * `decideOnStreamOnline`, which degrades to "extend" rather than splitting
   * mid-stream.
   */
  private eventTime(msg: Msg): Date {
    const stamp = readEventStamp(msg);
    if (stamp !== null) {
      const parsed = Date.parse(stamp);
      if (!Number.isNaN(parsed)) {
        return new Date(parsed);
      }
    }
    return new Date();
  }

  /**
   * Publishes through the shared factory with the session deliberately cleared.
   *
   * `Event()` stamps `sessionId` from the ambient holder, and an event
   * announcing a session must not also claim to have happened during one --
   * this announcement is what establishes it. An explicit `undefined` overrides
   * the holder, and undefined drops out at serialization, so the attribute is
   * absent rather than null.
   */
  private async publish(type: SessionEventType, data: Record<string, unknown>): Promise<void> {
    const event = Event<Record<string, unknown>>({ type, source: "api", sessionId: undefined }, data);
    await this.nats.publish(type, encode(event));
  }
}

/**
 * Epoch ms for a protoscript Timestamp, or undefined when the field was absent.
 *
 * protoscript declares message fields non-optional and fills them with
 * `Timestamp.initialize()` when the wire omits them, so absence arrives as a
 * zero timestamp rather than as undefined -- its own JSON serializer uses this
 * same `seconds || nanos` test to decide a timestamp is unset.
 *
 * The distinction is load-bearing. Undefined means "this session has never been
 * live"; reading it as epoch zero instead would make every `stream.online` look
 * like a return after fifty years and split the session every time.
 */
export function timestampToEpochMs(ts: { seconds?: bigint; nanos?: number } | undefined): number | undefined {
  if (!ts) {
    return undefined;
  }
  const seconds = ts.seconds ?? 0n;
  const nanos = ts.nanos ?? 0;
  if (seconds === 0n && nanos === 0) {
    return undefined;
  }
  return Number(seconds) * 1000 + Math.floor(nanos / 1_000_000);
}

function readEventStamp(msg: Msg): string | null {
  try {
    const ce = msg.json() as Record<string, unknown>;
    const data = (ce.data as Record<string, unknown> | undefined) ?? ce;
    if (typeof data.startedAt === "string") {
      return data.startedAt;
    }
    if (typeof data.started_at === "string") {
      return data.started_at;
    }
    if (typeof ce.time === "string") {
      return ce.time;
    }
    return null;
  } catch {
    return null;
  }
}
