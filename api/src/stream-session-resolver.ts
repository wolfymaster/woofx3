import { EngineEventType } from "@woofx3/api/webhooks";
import Event from "@woofx3/common/cloudevents/BaseEvent";
import { EventType as SessionEventType } from "@woofx3/common/cloudevents/Session/events";
import {
  EventType as StreamStatusEventType,
  type StreamStatusObserved,
} from "@woofx3/common/cloudevents/StreamStatus/events";
import { setCurrentSessionId } from "@woofx3/common/cloudevents/session";
import { EventType } from "@woofx3/common/cloudevents/Twitch/events";
import { encode } from "@woofx3/common/cloudevents/utils";
import type { SharedLogger } from "@woofx3/common/logging";
import type * as storage from "@woofx3/db/storage.pb";
import type * as stream_session from "@woofx3/db/stream_session.pb";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import { type DbClient, DbError } from "./db-client";
import { timestampFromDate, timestampToIso } from "./routes/helpers";
import { decideOnStreamOnline, isBroadcastOver, type OpenSessionState } from "./stream-session-policy";
import type { WebhookClient } from "./webhook-client";

/**
 * How often the resolver checks whether an offline stream's grace window has
 * passed. A late check delays the announcement but never moves the boundary,
 * which is the last segment's end.
 */
const BROADCAST_END_CHECK_INTERVAL_MS = 60_000;

/**
 * Owns which stream session the system is in.
 *
 * `stream.online` and `stream.offline` are inputs to a decision rather than
 * boundaries: going live asks whether to extend the open session or start a new
 * one, and going offline only closes a segment within whichever session is
 * open. A session ends at its last segment's end once the stream has stayed down
 * past the grace window, and an idle session takes over the offline time. A
 * session is always present, so this never has to answer "no session".
 *
 * The rule itself lives in `stream-session-policy.ts` and the storage in
 * db-proxy; this is the part that joins them to the bus. Everything else in the
 * system consumes `session.started` / `session.ended` and knows nothing about
 * grace windows.
 */
export class StreamSessionResolver {
  private sessionId: string | null = null;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * The tail of the running decisions. Each reads the session's state and then
   * writes, so a broadcast-end check overlapping a `stream.online` could close
   * the session the stream just went live in.
   */
  private decisions: Promise<void> = Promise.resolve();

  constructor(
    private nats: NATSClient,
    private db: DbClient,
    private logger: SharedLogger,
    private webhook: WebhookClient | null = null,
    private now: () => number = Date.now,
    private checkIntervalMs: number = BROADCAST_END_CHECK_INTERVAL_MS
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
    await this.nats.subscribe(StreamStatusEventType.StreamStatusObserved, (msg: Msg) =>
      this.handleStreamStatusObserved(msg)
    );

    // Resolve and announce before the first event arrives. A process that
    // restarted would otherwise publish unstamped until the next broadcast,
    // which on a quiet day is hours.
    await this.syncCurrentSession();

    // A stream that ended while this process was down is over already.
    await this.endBroadcastIfOver();
    this.checkTimer = setInterval(() => {
      void this.endBroadcastIfOver();
    }, this.checkIntervalMs);

    // After subscribing, so no answer is missed. A platform that connects later
    // publishes its state when it does.
    await this.requestStreamStatus();

    this.logger.info("StreamSessionResolver started", {
      subjects: [EventType.StreamOnline, EventType.StreamOffline],
    });
  }

  stop(): void {
    if (this.checkTimer !== null) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  /**
   * Closes the session if the stream has stayed down past the grace window.
   * Resolves when the check is done; a failure is logged and the next check
   * tries again. Exposed for tests.
   */
  endBroadcastIfOver(): Promise<void> {
    return this.inTurn(async () => {
      try {
        const state = await this.db.ensureCurrentStreamSession({});
        if (!state.session?.id) {
          this.logger.warn("StreamSessionResolver: no open stream session; skipping the broadcast-end check");
          return;
        }
        const decision = decisionState(state);
        if (isBroadcastOver(decision, this.now()) && decision.lastSegmentEndedAt !== undefined) {
          await this.endBroadcast(new Date(decision.lastSegmentEndedAt));
        }
      } catch (err) {
        this.logger.error("StreamSessionResolver: checking whether the broadcast ended failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  private inTurn(decide: () => Promise<void>): Promise<void> {
    this.decisions = this.decisions.then(decide);
    return this.decisions;
  }

  /**
   * Ends the broadcast's session at `endedAt` and leaves an idle session holding
   * the offline time from then on. Events stamped since then are unaffected:
   * analytics attributes an event by when it occurred.
   */
  private async endBroadcast(endedAt: Date): Promise<string> {
    const split = await this.db.splitStreamSession({ at: timestampFromDate(endedAt) });
    if (!split.ended?.id || !split.started?.id) {
      throw new Error("split did not return both the ended session and its successor");
    }
    await this.clearSessionScopedStorage(split.ended.id);
    await this.publish(SessionEventType.SessionEnded, {
      sessionId: split.ended.id,
      endedAt: endedAt.toISOString(),
      replacedBySessionId: split.started.id,
    });
    await this.adoptSession(split.started.id, endedAt.toISOString());
    return split.started.id;
  }

  private async syncCurrentSession(): Promise<void> {
    try {
      const state = await this.db.ensureCurrentStreamSession({});
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

  private async requestStreamStatus(): Promise<void> {
    try {
      await this.publish(StreamStatusEventType.StreamStatusRequested, {});
    } catch (err) {
      this.logger.warn("StreamSessionResolver: could not ask the platforms whether the stream is live", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private handleStreamOnline(msg: Msg): Promise<void> {
    return this.streamWentLive(this.eventTime(msg));
  }

  private handleStreamOffline(msg: Msg): Promise<void> {
    return this.streamWentOffline(this.eventTime(msg));
  }

  /**
   * Brings the session in line with what a platform says is true now, for the
   * changes this process was not running to hear. The same decisions as the two
   * events above, and as safe to repeat, so a state that already matches changes
   * nothing. `stream.online` itself is not published: that is what would replay
   * what going live does.
   */
  private async handleStreamStatusObserved(msg: Msg): Promise<void> {
    const status = readStreamStatus(msg);
    if (status === null) {
      this.logger.warn(`${StreamStatusEventType.StreamStatusObserved}: malformed event; skipping`);
      return;
    }
    if (!status.live) {
      await this.streamWentOffline(new Date());
      return;
    }
    const startedAt = status.startedAt === undefined ? Number.NaN : Date.parse(status.startedAt);
    await this.streamWentLive(Number.isNaN(startedAt) ? new Date() : new Date(startedAt));
  }

  private streamWentLive(at: Date): Promise<void> {
    return this.inTurn(() => this.decideOnLive(at));
  }

  private streamWentOffline(at: Date): Promise<void> {
    return this.inTurn(() => this.closeSegment(at));
  }

  private async decideOnLive(at: Date): Promise<void> {
    try {
      const state = await this.db.ensureCurrentStreamSession({});
      if (!state.session?.id) {
        this.logger.warn(`${EventType.StreamOnline}: no open stream session; skipping`);
        return;
      }

      const decision = decisionState(state);
      const action = decideOnStreamOnline(decision, at.getTime());

      let sessionId = state.session.id;
      let replacedSessionId: string | null = null;

      if (action === "split") {
        // Only reached with a broadcast still open if no check ran since its
        // grace window passed. It ends where it always would have.
        if (decision.lastSegmentEndedAt !== undefined) {
          await this.endBroadcast(new Date(decision.lastSegmentEndedAt));
        }
        const split = await this.db.splitStreamSession({
          at: timestampFromDate(at),
        });
        if (!split.started?.id) {
          this.logger.error(`${EventType.StreamOnline}: split returned no successor session`);
          return;
        }
        replacedSessionId = split.ended?.id || null;
        sessionId = split.started.id;
      }

      // Persist before announcing: a session event nobody can look up is worse
      // than a late one.
      await this.db.openStreamSessionSegment({
        streamSessionId: sessionId,
        startedAt: timestampFromDate(at),
      });

      // An idle session is not a broadcast, so its end is not announced: no
      // recap follows it. Values written while offline must still not carry
      // into the broadcast.
      if (replacedSessionId) {
        await this.clearSessionScopedStorage(replacedSessionId);
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

  private async closeSegment(at: Date): Promise<void> {
    try {
      // Only the segment closes. The session stays open through the grace
      // window -- a stream that ends is not yet a session that ends, which is
      // the whole reason a dropout does not wipe session-scoped state.
      await this.db.closeStreamSessionSegment({
        endedAt: timestampFromDate(at),
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
      startedAt,
    });
    await this.announceToUi(sessionId, startedAt);
  }

  /**
   * Tell the UI which session it is in.
   *
   * Sent from here rather than folded into the `stream.online` webhook because
   * that handler and this resolver are separate subscribers to the same bus
   * subject with no ordering between them — on a split, the stream handler can
   * still be holding the session this one just replaced.
   *
   * Failure is logged and swallowed. The bus event is the contract; this is a
   * projection of it, and a webhook that did not land must not stop the engine
   * adopting the session.
   */
  private async announceToUi(sessionId: string, startedAt: string): Promise<void> {
    if (!this.webhook) {
      return;
    }
    try {
      await this.webhook.send({
        type: EngineEventType.SESSION_STARTED,
        sessionId,
        startedAt,
      });
    } catch (err) {
      this.logger.error("Failed to announce the stream session to the UI", {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
      const cleared = await this.db.clearSessionScoped({});
      this.logger.info("Cleared session-scoped module storage", { endedSessionId, cleared: cleared.length });
      await this.announceCleared(cleared);
    } catch (err) {
      this.logger.error("Failed to clear session-scoped module storage", {
        endedSessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Announce each cleared key the way a module's own write is announced
   * (barkloader's storage_event.rs), with a null value.
   *
   * Without this, anything showing a session value -- a counter on the
   * dashboard, a widget on stream -- keeps showing the last one after the value
   * is gone. One failed announcement does not stop the rest.
   */
  private async announceCleared(cleared: storage.StorageItem[]): Promise<void> {
    const occurredAt = new Date().toISOString();
    for (const item of cleared) {
      const subject = `module.storage.${item.namespace}.changed`;
      const event = Event(
        { type: "module.storage.changed", source: "api" },
        { moduleId: item.namespace, key: item.key, value: null, occurredAt }
      );
      try {
        await this.nats.publish(subject, encode(event));
      } catch (err) {
        this.logger.warn("Failed to announce a cleared session value", {
          namespace: item.namespace,
          key: item.key,
          error: err instanceof Error ? err.message : String(err),
        });
      }
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
  private async publish(type: SessionEventType | StreamStatusEventType, data: Record<string, unknown>): Promise<void> {
    const event = Event<Record<string, unknown>>({ type, source: "api", sessionId: undefined }, data);
    await this.nats.publish(type, encode(event));
  }
}

function decisionState(state: stream_session.StreamSessionStateResponse): OpenSessionState {
  const startedAt = timestampToEpochMs(state.session?.startedAt);
  if (startedAt === undefined) {
    throw new Error(`stream session ${state.session?.id} has no start time`);
  }
  return {
    startedAt,
    isSegmentOpen: state.isSegmentOpen === true,
    lastSegmentEndedAt: timestampToEpochMs(state.lastSegmentEndedAt),
  };
}

/** The data of a `stream.status.observed`, or null when it is not one. */
function readStreamStatus(msg: Msg): StreamStatusObserved | null {
  try {
    const data = (msg.json() as { data?: { live?: unknown; startedAt?: unknown } }).data;
    if (typeof data?.live !== "boolean") {
      return null;
    }
    return typeof data.startedAt === "string" ? { live: data.live, startedAt: data.startedAt } : { live: data.live };
  } catch {
    // Not JSON at all: the same as any other malformed event, which the caller logs.
    return null;
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
