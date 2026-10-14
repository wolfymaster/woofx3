import { describe, expect, test } from "bun:test";
import type { EventLogPage, EventLogQuery } from "@woofx3/api";
import type * as user_event from "@woofx3/db/user_event.pb";
import { decodeCursor, streamEventsRoutes } from "../src/routes/stream-events";

const ROW_ID = "7f0c5a1e-0000-4000-8000-000000000001";

function event(overrides: Partial<user_event.UserEvent>): user_event.UserEvent {
  return {
    id: ROW_ID,
    eventId: "ce-1",
    source: "twitch",
    eventType: "channel.cheer",
    platform: "twitch",
    eventValue: '{"amount":100}',
    occurredAt: { seconds: 1_790_000_000n, nanos: 123_456_789 },
    createdAt: { seconds: 1_790_000_000n, nanos: 0 },
    ...overrides,
  };
}

/** The route touches only `db`, so that is all the host needs. */
function setup(page: { events: user_event.UserEvent[]; more: boolean }) {
  const requests: Partial<user_event.ListRecentUserEventsRequest>[] = [];
  const ctx = {
    db: {
      async listRecentUserEvents(req: Partial<user_event.ListRecentUserEventsRequest>) {
        requests.push(req);
        return { ...page, total: BigInt(page.events.length) };
      },
    },
  };
  const route = streamEventsRoutes.listEvents as unknown as (query?: EventLogQuery) => Promise<EventLogPage>;
  return { listEvents: (query?: EventLogQuery) => route.call(ctx, query), requests };
}

describe("listEvents", () => {
  test("maps each logged event to the frame subscribeStreamEvents pushes", async () => {
    const { listEvents, requests } = setup({ events: [event({})], more: false });

    const page = await listEvents();

    expect(requests).toEqual([{ limit: 50 }]);
    expect(page).toEqual({
      events: [
        {
          id: "ce-1",
          type: "channel.cheer",
          source: "twitch",
          time: "2026-09-21T14:13:20.123Z",
          platform: "twitch",
          data: { amount: 100 },
        },
      ],
      nextCursor: null,
    });
  });

  test("hands back the last event's exact position as the cursor of the next page", async () => {
    const first = setup({ events: [event({ id: "7f0c5a1e-0000-4000-8000-000000000009" }), event({})], more: true });

    const page = await first.listEvents({ types: ["channel.cheer", "kofi.donation"], limit: 2 });

    expect(page.nextCursor).not.toBeNull();
    const second = setup({ events: [], more: false });
    await second.listEvents({ cursor: page.nextCursor ?? undefined, types: ["channel.cheer"] });
    expect(second.requests).toEqual([
      {
        limit: 50,
        eventTypes: ["channel.cheer"],
        before: { occurredAt: { seconds: 1_790_000_000n, nanos: 123_456_789 }, id: ROW_ID },
      },
    ]);
    expect(first.requests[0]?.eventTypes).toEqual(["channel.cheer", "kofi.donation"]);
  });

  test("an empty type list reads every type", async () => {
    const { listEvents, requests } = setup({ events: [], more: false });

    await listEvents({ types: [] });

    expect(requests).toEqual([{ limit: 50 }]);
  });

  test("rejects a bad limit, type or cursor", async () => {
    const { listEvents } = setup({ events: [], more: false });

    await expect(listEvents({ limit: 0 })).rejects.toThrow("limit");
    await expect(listEvents({ limit: 101 })).rejects.toThrow("limit");
    await expect(listEvents({ types: [""] })).rejects.toThrow("types");
    await expect(listEvents({ cursor: "not-a-cursor" })).rejects.toThrow("cursor");
    expect(() => decodeCursor(Buffer.from("1:2:not-a-uuid").toString("base64url"))).toThrow("cursor");
  });
});
