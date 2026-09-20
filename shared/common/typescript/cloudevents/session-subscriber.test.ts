import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventType } from "./Session/events";
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

    expect(handlers.has(EventType.SessionStarted)).toBe(true);
  });

  // Clearing on `session.ended` would leave a window with no session: the
  // resolver emits `ended` immediately followed by `started` for the successor,
  // and events published in between would go out unstamped.
  test("does not subscribe to session.ended", async () => {
    const { bus, handlers } = fakeBus();

    await subscribeToSessionUpdates(bus);

    expect(handlers.has(EventType.SessionEnded)).toBe(false);
  });

  test("feeds the holder so Event() can stamp", async () => {
    const { bus, handlers } = fakeBus();
    await subscribeToSessionUpdates(bus);

    handlers.get(EventType.SessionStarted)?.(message({ data: { sessionId: "session-1" } }));

    expect(getCurrentSessionId()).toBe("session-1");
  });

  test("accepts a bare payload, since nothing validates envelopes on the way in", async () => {
    const { bus, handlers } = fakeBus();
    await subscribeToSessionUpdates(bus);

    handlers.get(EventType.SessionStarted)?.(message({ sessionId: "session-1" }));

    expect(getCurrentSessionId()).toBe("session-1");
  });

  test("a later announcement replaces the current session", async () => {
    const { bus, handlers } = fakeBus();
    await subscribeToSessionUpdates(bus);
    const handler = handlers.get(EventType.SessionStarted);

    handler?.(message({ data: { sessionId: "session-1" } }));
    handler?.(message({ data: { sessionId: "session-2" } }));

    expect(getCurrentSessionId()).toBe("session-2");
  });

  // Keeping the previous session beats dropping to unstamped on one bad message.
  test("a malformed payload leaves the previous session in place", async () => {
    const { bus, handlers } = fakeBus();
    await subscribeToSessionUpdates(bus);
    const handler = handlers.get(EventType.SessionStarted);
    handler?.(message({ data: { sessionId: "session-1" } }));

    handler?.(message({ data: {} }));
    handler?.(message({ data: { sessionId: "" } }));

    expect(getCurrentSessionId()).toBe("session-1");
  });

  // A throw kills the subscription and stops delivery of everything behind it.
  test("a payload that cannot be parsed does not throw", async () => {
    const { bus, handlers } = fakeBus();
    await subscribeToSessionUpdates(bus);
    const handler = handlers.get(EventType.SessionStarted);

    expect(() =>
      handler?.({
        json: () => {
          throw new Error("not json");
        },
      })
    ).not.toThrow();
  });
});
