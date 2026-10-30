import type {
  EventLogPage,
  EventLogQuery,
  EventLogSelection,
  EventLogSettings,
  StreamEventFrame,
  StreamEventSubscriber,
} from "@woofx3/api";
import type * as user_event from "@woofx3/db/user_event.pb";
import { timestampToEpochMs } from "../stream-session-resolver";
import { routeModule } from "./context";

const DEFAULT_EVENT_LOG_LIMIT = 50;
const MAX_EVENT_LOG_LIMIT = 100;

export const streamEventsRoutes = routeModule({
  /**
   * Subscribe to live stream events for the session's lifetime. `ApiSession`
   * passes itself as `context.session`, so a client's later call replaces its
   * earlier one; without it each call is a registration of its own.
   *
   * Throws rather than accepting a subscription it cannot serve: without NATS
   * the engine receives no events at all, and silently registering a callback
   * that never fires looks identical to a quiet stream.
   */
  async subscribeStreamEvents(
    callback: StreamEventSubscriber,
    types?: string[],
    context?: { session: object; clientId: string }
  ): Promise<void> {
    if (!this.streamEventBroadcaster) {
      throw new Error("Stream events are unavailable: the engine has no NATS connection");
    }
    if (types !== undefined && !isEventTypeList(types)) {
      throw new Error("types must be a list of non-empty strings");
    }
    await this.streamEventBroadcaster.subscribe(
      callback,
      types,
      context?.session ?? callback,
      context?.clientId ?? null
    );
  },

  async getEventLogSettings(): Promise<EventLogSettings> {
    if (!this.eventLogSelection) {
      throw new Error("Event log settings are unavailable: the engine has no NATS connection");
    }
    return this.eventLogSelection.settings;
  },

  async setEventLogSelection(selection: EventLogSelection): Promise<EventLogSettings> {
    if (!this.eventLogSelection) {
      throw new Error("Event log settings are unavailable: the engine has no NATS connection");
    }
    return this.eventLogSelection.setSelection(selection);
  },

  async listEvents(query?: EventLogQuery): Promise<EventLogPage> {
    const { types, before, limit } = readEventLogQuery(query);
    // A page needs no count of the whole span, which is a scan of every
    // matching row on each request.
    const page = await this.db.listRecentUserEvents({
      limit,
      skipTotal: true,
      ...(types.length > 0 ? { eventTypes: types } : {}),
      ...(before !== undefined ? { before } : {}),
    });
    const last = page.events.at(-1);
    return {
      events: page.events.map(toFrame),
      nextCursor: page.more && last !== undefined ? encodeCursor(last) : null,
    };
  },
});

function readEventLogQuery(query: EventLogQuery | undefined): {
  types: string[];
  before: user_event.UserEventPosition | undefined;
  limit: number;
} {
  const limit = query?.limit ?? DEFAULT_EVENT_LOG_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EVENT_LOG_LIMIT) {
    throw new Error(`limit must be an integer from 1 to ${MAX_EVENT_LOG_LIMIT}`);
  }
  const types = query?.types ?? [];
  if (!isEventTypeList(types)) {
    throw new Error("types must be a list of non-empty strings");
  }
  const before = query?.cursor === undefined ? undefined : decodeCursor(query.cursor);
  return { types, before, limit };
}

function isEventTypeList(types: unknown): types is string[] {
  return Array.isArray(types) && types.every((type) => typeof type === "string" && type.length > 0);
}

/**
 * A cursor is the position of the last event of a page, its occurred_at to
 * the nanosecond and its row id: the key the log is ordered by. Exact time
 * matters, since a cursor rounded to the millisecond would skip or repeat the
 * events of a page boundary that falls inside one millisecond.
 */
function encodeCursor(event: user_event.UserEvent): string {
  if (event.occurredAt === undefined) {
    throw new Error(`event log row ${event.id} has no occurredAt`);
  }
  const { seconds, nanos } = event.occurredAt;
  return Buffer.from(`${seconds}:${nanos}:${event.id}`, "utf8").toString("base64url");
}

/** Exported for tests. */
export function decodeCursor(cursor: unknown): user_event.UserEventPosition {
  const invalid = new Error("cursor is not one this engine issued");
  if (typeof cursor !== "string" || cursor.length === 0) {
    throw invalid;
  }
  const match = /^(\d{1,19}):(\d{1,9}):([0-9a-f-]{36})$/.exec(Buffer.from(cursor, "base64url").toString("utf8"));
  if (match === null) {
    throw invalid;
  }
  const [, seconds, nanos, id] = match as unknown as [string, string, string, string];
  return { occurredAt: { seconds: BigInt(seconds), nanos: Number(nanos) }, id };
}

/** Exported for tests. The frame `subscribeStreamEvents` pushed for the same event. */
export function toFrame(event: user_event.UserEvent): StreamEventFrame {
  const ms = timestampToEpochMs(event.occurredAt);
  if (ms === undefined) {
    throw new Error(`event log row ${event.id} has no occurredAt`);
  }
  return {
    id: event.eventId,
    type: event.eventType,
    source: event.source,
    time: new Date(ms).toISOString(),
    platform: event.platform,
    // db-proxy accepts only valid JSON into event_value.
    data: JSON.parse(event.eventValue),
  };
}
