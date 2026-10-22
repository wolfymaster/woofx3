import { describe, expect, test } from "bun:test";
import type {
  EventLogPage,
  EventLogQuery,
  EventLogSelection,
  EventLogSettings,
  StreamEventSubscriber,
} from "@woofx3/api";
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

    expect(requests).toEqual([{ limit: 50, skipTotal: true }]);
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
        skipTotal: true,
        eventTypes: ["channel.cheer"],
        before: { occurredAt: { seconds: 1_790_000_000n, nanos: 123_456_789 }, id: ROW_ID },
      },
    ]);
    expect(first.requests[0]?.eventTypes).toEqual(["channel.cheer", "kofi.donation"]);
  });

  test("an empty type list reads every type", async () => {
    const { listEvents, requests } = setup({ events: [], more: false });

    await listEvents({ types: [] });

    expect(requests).toEqual([{ limit: 50, skipTotal: true }]);
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

describe("subscribeStreamEvents", () => {
  type Subscribe = (
    callback: StreamEventSubscriber,
    types?: string[],
    context?: { session: object; clientId: string }
  ) => Promise<void>;
  const route = streamEventsRoutes.subscribeStreamEvents as unknown as Subscribe;

  function host() {
    const calls: unknown[][] = [];
    const ctx = {
      streamEventBroadcaster: {
        async subscribe(...args: unknown[]) {
          calls.push(args);
        },
      },
    };
    return { calls, subscribe: (...args: Parameters<Subscribe>) => route.call(ctx, ...args) };
  }

  test("registers under the caller's session, or under the callback when there is none", async () => {
    const { calls, subscribe } = host();
    const callback = { onStreamEvent: async () => {} };
    const session = {};

    await subscribe(callback, ["goal.reached"], { session, clientId: "c1" });
    await subscribe(callback);

    expect(calls).toEqual([
      [callback, ["goal.reached"], session, "c1"],
      [callback, undefined, callback, null],
    ]);
  });

  test("rejects a type list that is not one", async () => {
    const { subscribe } = host();
    const callback = { onStreamEvent: async () => {} };

    await expect(subscribe(callback, "goal.reached" as unknown as string[])).rejects.toThrow("types");
    await expect(subscribe(callback, [""])).rejects.toThrow("types");
  });

  test("refuses when the engine has no bus", async () => {
    await expect(route.call({ streamEventBroadcaster: null }, { onStreamEvent: async () => {} })).rejects.toThrow(
      "no NATS connection"
    );
  });
});

describe("event log settings", () => {
  const settings: EventLogSettings = {
    selection: { shown: [], hidden: [] },
    defaults: ["channel.follow"],
    offered: ["channel.follow"],
    enabled: ["channel.follow"],
  };
  const get = streamEventsRoutes.getEventLogSettings as unknown as () => Promise<EventLogSettings>;
  const set = streamEventsRoutes.setEventLogSelection as unknown as (
    selection: EventLogSelection
  ) => Promise<EventLogSettings>;

  test("reads and saves through the engine's selection", async () => {
    const saved: unknown[] = [];
    const ctx = {
      eventLogSelection: {
        settings,
        async setSelection(selection: unknown) {
          saved.push(selection);
          return settings;
        },
      },
    };

    expect(await get.call(ctx)).toBe(settings);
    expect(await set.call(ctx, { shown: ["wheel.landed"], hidden: [] })).toBe(settings);
    expect(saved).toEqual([{ shown: ["wheel.landed"], hidden: [] }]);
  });

  test("refuses when the engine has no bus", async () => {
    await expect(get.call({ eventLogSelection: null })).rejects.toThrow("no NATS connection");
    await expect(set.call({ eventLogSelection: null }, { shown: [], hidden: [] })).rejects.toThrow(
      "no NATS connection"
    );
  });
});
