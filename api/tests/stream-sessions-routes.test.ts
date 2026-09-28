import { describe, expect, test } from "bun:test";
import type { PaginatedStreamSessions, StreamSession, StreamSessionsQuery } from "@woofx3/api";
import type * as stream_session from "@woofx3/db/stream_session.pb";
import { streamSessionsRoutes } from "../src/routes/stream-sessions";

type Timestamp = { seconds: bigint; nanos: number };

/** What protoscript decodes an absent timestamp into. */
const ABSENT: Timestamp = { seconds: 0n, nanos: 0 };

function at(iso: string): Timestamp {
  const ms = Date.parse(iso);
  return { seconds: BigInt(Math.floor(ms / 1000)), nanos: (ms % 1000) * 1_000_000 };
}

function session(id: string, status: string, startedAt: string, endedAt?: string): stream_session.StreamSession {
  return {
    id,
    status,
    startedAt: at(startedAt),
    endedAt: endedAt ? at(endedAt) : ABSENT,
    createdAt: at(startedAt),
    updatedAt: at(startedAt),
  };
}

function segment(
  id: string,
  streamSessionId: string,
  startedAt: string,
  endedAt?: string
): stream_session.StreamSessionSegment {
  return {
    id,
    streamSessionId,
    startedAt: at(startedAt),
    endedAt: endedAt ? at(endedAt) : ABSENT,
    createdAt: at(startedAt),
    updatedAt: at(startedAt),
  };
}

type Page = {
  sessions: stream_session.StreamSession[];
  segments: stream_session.StreamSessionSegment[];
  totalCount: number;
};

/**
 * The routes are a mixin over the api's route host and touch only `db`, so
 * that is all the host needs here.
 */
function setup(page: Page) {
  const listRequests: Array<{ limit: number; offset: number }> = [];
  const ctx = {
    db: {
      async listStreamSessions(req: { limit: number; offset: number }) {
        listRequests.push(req);
        return { ...page, limit: req.limit, offset: req.offset };
      },
      async findStreamSession(req: { id: string }) {
        const found = page.sessions.find((s) => s.id === req.id);
        if (!found) {
          return null;
        }
        return { session: found, segments: page.segments.filter((s) => s.streamSessionId === req.id) };
      },
    },
  };
  const list = streamSessionsRoutes.listStreamSessions as unknown as (
    query?: StreamSessionsQuery
  ) => Promise<PaginatedStreamSessions>;
  const get = streamSessionsRoutes.getStreamSession as unknown as (id: string) => Promise<StreamSession | null>;
  return {
    listRequests,
    list: (query?: StreamSessionsQuery) => list.call(ctx, query),
    get: (id: string) => get.call(ctx, id),
  };
}

const livePage: Page = {
  sessions: [
    session("s-open", "open", "2026-09-27T22:00:00.000Z"),
    session("s-closed", "closed", "2026-09-27T18:00:00.000Z", "2026-09-27T22:00:00.000Z"),
  ],
  segments: [
    segment("g-1", "s-closed", "2026-09-27T18:05:00.000Z", "2026-09-27T19:00:00.000Z"),
    segment("g-2", "s-closed", "2026-09-27T19:10:00.000Z", "2026-09-27T21:00:00.000Z"),
    segment("g-3", "s-open", "2026-09-27T22:01:00.000Z"),
  ],
  totalCount: 2,
};

describe("listStreamSessions", () => {
  test("returns each session with its own segments, oldest first", async () => {
    const { list } = setup(livePage);

    const page = await list();

    expect(page.total).toBe(2);
    expect(page.sessions.map((s) => s.id)).toEqual(["s-open", "s-closed"]);
    expect(page.sessions[1]).toEqual({
      id: "s-closed",
      status: "closed",
      startedAt: "2026-09-27T18:00:00.000Z",
      endedAt: "2026-09-27T22:00:00.000Z",
      segments: [
        { id: "g-1", startedAt: "2026-09-27T18:05:00.000Z", endedAt: "2026-09-27T19:00:00.000Z" },
        { id: "g-2", startedAt: "2026-09-27T19:10:00.000Z", endedAt: "2026-09-27T21:00:00.000Z" },
      ],
    });
  });

  test("reports an open session and a live segment with null ends, not epoch zero", async () => {
    const { list } = setup(livePage);

    const open = (await list()).sessions[0];

    expect(open.endedAt).toBeNull();
    expect(open.segments).toEqual([{ id: "g-3", startedAt: "2026-09-27T22:01:00.000Z", endedAt: null }]);
  });

  test("gives a session that has never been live an empty segment list", async () => {
    const { list } = setup({
      sessions: [session("s-new", "open", "2026-09-27T22:00:00.000Z")],
      segments: [],
      totalCount: 1,
    });

    const page = await list();

    expect(page.sessions[0].segments).toEqual([]);
  });

  test("defaults the page and passes an explicit one through", async () => {
    const { list, listRequests } = setup(livePage);

    await list();
    const page = await list({ limit: 10, offset: 20 });

    expect(listRequests).toEqual([
      { limit: 50, offset: 0 },
      { limit: 10, offset: 20 },
    ]);
    expect(page.limit).toBe(10);
    expect(page.offset).toBe(20);
  });

  test("rejects a page it would otherwise have to guess at", async () => {
    const { list, listRequests } = setup(livePage);

    for (const query of [{ limit: 0 }, { limit: 201 }, { limit: 1.5 }, { offset: -1 }]) {
      await expect(list(query)).rejects.toThrow();
    }
    expect(listRequests).toEqual([]);
  });

  test("fails on a session whose start db-proxy left empty", async () => {
    const broken = session("s-broken", "open", "2026-09-27T22:00:00.000Z");
    broken.startedAt = ABSENT;
    const { list } = setup({ sessions: [broken], segments: [], totalCount: 1 });

    await expect(list()).rejects.toThrow("startedAt");
  });

  test("fails on a status outside the contract", async () => {
    const { list } = setup({
      sessions: [session("s-odd", "merged", "2026-09-27T22:00:00.000Z")],
      segments: [],
      totalCount: 1,
    });

    await expect(list()).rejects.toThrow("merged");
  });
});

describe("getStreamSession", () => {
  test("returns the session with its segments", async () => {
    const { get } = setup(livePage);

    const found = await get("s-closed");

    expect(found?.segments.map((s) => s.id)).toEqual(["g-1", "g-2"]);
  });

  test("returns null for an id with no session, such as one a split removed", async () => {
    const { get } = setup(livePage);

    expect(await get("s-gone")).toBeNull();
  });
});
