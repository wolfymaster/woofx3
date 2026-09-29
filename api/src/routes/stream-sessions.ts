import type { PaginatedStreamSessions, StreamSession, StreamSessionSegment, StreamSessionsQuery } from "@woofx3/api";
import type * as stream_session from "@woofx3/db/stream_session.pb";
import type { DbClient } from "../db-client";
import { timestampToEpochMs } from "../stream-session-resolver";
import { routeModule } from "./context";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type Timestamp = { seconds?: bigint; nanos?: number } | undefined;

/**
 * ISO 8601 for a timestamp the schema never leaves empty. An absent one means
 * the row is not what the schema promises, so it fails rather than inventing
 * a time.
 */
function requiredIso(ts: Timestamp, field: string): string {
  const ms = timestampToEpochMs(ts);
  if (ms === undefined) {
    throw new Error(`stream session ${field} is missing`);
  }
  return new Date(ms).toISOString();
}

/**
 * ISO 8601, or null when the timestamp is absent. protoscript decodes an
 * absent timestamp as a zero one, and epoch zero must never reach a client as
 * a real end time.
 */
function optionalIso(ts: Timestamp): string | null {
  const ms = timestampToEpochMs(ts);
  return ms === undefined ? null : new Date(ms).toISOString();
}

function toSegment(segment: stream_session.StreamSessionSegment): StreamSessionSegment {
  return {
    id: segment.id,
    startedAt: requiredIso(segment.startedAt, "segment startedAt"),
    endedAt: optionalIso(segment.endedAt),
  };
}

function toSession(
  session: stream_session.StreamSession,
  segments: stream_session.StreamSessionSegment[]
): StreamSession {
  if (session.status !== "open" && session.status !== "closed") {
    throw new Error(`stream session ${session.id} has unknown status "${session.status}"`);
  }
  return {
    id: session.id,
    status: session.status,
    startedAt: requiredIso(session.startedAt, "startedAt"),
    endedAt: optionalIso(session.endedAt),
    segments: segments.map(toSegment),
  };
}

function segmentsBySession(
  segments: stream_session.StreamSessionSegment[]
): Map<string, stream_session.StreamSessionSegment[]> {
  const grouped = new Map<string, stream_session.StreamSessionSegment[]>();
  for (const segment of segments) {
    const owned = grouped.get(segment.streamSessionId);
    if (owned) {
      owned.push(segment);
    } else {
      grouped.set(segment.streamSessionId, [segment]);
    }
  }
  return grouped;
}

function readPaging(query: StreamSessionsQuery | undefined): { limit: number; offset: number } {
  const limit = query?.limit ?? DEFAULT_LIMIT;
  const offset = query?.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("offset must be a non-negative integer");
  }
  return { limit, offset };
}

/** A session with its segments, or null when no session has that id. */
export async function readStreamSession(
  db: Pick<DbClient, "findStreamSession">,
  id: string
): Promise<StreamSession | null> {
  const found = await db.findStreamSession({ id });
  if (!found) {
    return null;
  }
  return toSession(found.session, found.segments);
}

export const streamSessionsRoutes = routeModule({
  async listStreamSessions(query?: StreamSessionsQuery): Promise<PaginatedStreamSessions> {
    const paging = readPaging(query);
    const page = await this.db.listStreamSessions(paging);
    const owned = segmentsBySession(page.segments);
    return {
      sessions: page.sessions.map((session) => toSession(session, owned.get(session.id) ?? [])),
      total: page.totalCount,
      limit: page.limit,
      offset: page.offset,
    };
  },

  async getStreamSession(id: string): Promise<StreamSession | null> {
    return readStreamSession(this.db, id);
  },
});
