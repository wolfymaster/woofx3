import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SessionEndedEventType, SessionStartedEventType } from "./messages.gen";
import { clearCurrentSessionId, getCurrentSessionId } from "./session";
import { type SessionBus, subscribeToSessionUpdates } from "./session-subscriber";

type Handler = (msg: { json(): unknown }) => void;

function fakeBus() {
  const handlers = new Map<string, Handler>();
  const bus: SessionBus = {
    subscribe: async (subject, handler) => {
      handlers.set(subject, handler);
      return undefined;
    },
  };
  return { bus, handlers };
}

function started(sessionId: string): unknown {
  return {
    specversion: "1.0.0",
    id: "7c3f0f55-0c4b-4a37-a2a5-2d1f1c8b9e10",
    type: "session.started",
    source: "api",
    time: "2026-11-19T10:15:30.123Z",
    data: { sessionId, startedAt: "2026-11-19T10:15:30.123Z" },
  };
}

function message(payload: unknown): { json(): unknown } {
  return { json: () => payload };
}

const warnings: string[] = [];
const realWarn = console.warn;

beforeEach(() => {
  clearCurrentSessionId();
  warnings.length = 0;
  // getCurrentSessionId warns when unset; capture so assertions stay readable.
  console.warn = (...args: unknown[]) => {
    warnings.push(args.join(" "));
  };
});

afterEach(() => {
  console.warn = realWarn;
  clearCurrentSessionId();
});

describe("subscribeToSessionUpdates", () => {
  test("subscribes to session.started", async () => {
    const { bus, handlers } = fakeBus();

    await subscribeToSessionUpdates(bus);

    expect(handlers.has(SessionStartedEventType.session_started)).toBe(true);
  });

  // Clearing on `session.ended` would leave a window with no session: the
  // resolver emits `ended` immediately followed by `started` for the successor,
  // and events published in between would go out unstamped.
  test("does not subscribe to session.ended", async () => {
    const { bus, handlers } = fakeBus();

    await subscribeToSessionUpdates(bus);

    expect(handlers.has(SessionEndedEventType.session_ended)).toBe(false);
  });

  test("feeds the holder so Event() can stamp", async () => {
    const { bus, handlers } = fakeBus();
    await subscribeToSessionUpdates(bus);

    handlers.get(SessionStartedEventType.session_started)?.(message(started("session-1")));

    expect(getCurrentSessionId()).toBe("session-1");
  });

  test("refuses a bare payload with no envelope", async () => {
    const { bus, handlers } = fakeBus();
    await subscribeToSessionUpdates(bus);

    handlers.get(SessionStartedEventType.session_started)?.(message({ sessionId: "session-1" }));

    expect(getCurrentSessionId()).toBeUndefined();
  });

  test("a later announcement replaces the current session", async () => {
    const { bus, handlers } = fakeBus();
    await subscribeToSessionUpdates(bus);
    const handler = handlers.get(SessionStartedEventType.session_started);

    handler?.(message(started("session-1")));
    handler?.(message(started("session-2")));

    expect(getCurrentSessionId()).toBe("session-2");
  });

  // Keeping the previous session beats dropping to unstamped on one bad message.
  test("a malformed payload leaves the previous session in place", async () => {
    const { bus, handlers } = fakeBus();
    await subscribeToSessionUpdates(bus);
    const handler = handlers.get(SessionStartedEventType.session_started);
    handler?.(message(started("session-1")));

    handler?.(message({ ...(started("session-2") as object), data: {} }));
    handler?.(message(started("")));

    expect(getCurrentSessionId()).toBe("session-1");
  });

  // A throw kills the subscription and stops delivery of everything behind it.
  test("a payload that cannot be parsed does not throw", async () => {
    const { bus, handlers } = fakeBus();
    await subscribeToSessionUpdates(bus);
    const handler = handlers.get(SessionStartedEventType.session_started);

    expect(() =>
      handler?.({
        json: () => {
          throw new Error("not json");
        },
      })
    ).not.toThrow();
  });
});
