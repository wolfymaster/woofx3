import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import Event from "./BaseEvent";
import { clearCurrentSessionId, setCurrentSessionId } from "./session";

// The missing-session path warns by design, so every test that exercises it
// would otherwise print. Capturing rather than silencing keeps the warning
// itself testable.
const warnings: string[] = [];
const realWarn = console.warn;

beforeEach(() => {
  clearCurrentSessionId();
  warnings.length = 0;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.join(" "));
  };
});

afterEach(() => {
  console.warn = realWarn;
  clearCurrentSessionId();
});

describe("session stamping in Event()", () => {
  test("stamps the current session", () => {
    setCurrentSessionId("session-1");
    expect(Event({ type: "channel.follow", source: "twitch" }, {}).sessionId).toBe("session-1");
  });

  test("stamps every family, not just the one that sets platform", () => {
    setCurrentSessionId("session-1");
    const twitch = Event({ type: "channel.follow", source: "twitch", platform: "twitch" }, {});
    const chat = Event({ type: "user.message", source: "chat" }, {});

    expect(twitch.sessionId).toBe("session-1");
    expect(chat.sessionId).toBe("session-1");
    expect(chat.platform).toBeUndefined();
  });

  test("omits the attribute when no session is known", () => {
    const event = Event({ type: "module.started", source: "module" }, {});

    expect(event.sessionId).toBeUndefined();
    // The stamp is written unconditionally, so absence depends on undefined
    // dropping out at serialization rather than on a null reaching the bus.
    expect(JSON.parse(JSON.stringify(event))).not.toHaveProperty("sessionId");
  });

  test("an explicit session in opts wins over the ambient one", () => {
    setCurrentSessionId("ambient");
    expect(Event({ type: "t", source: "s", sessionId: "explicit" }, {}).sessionId).toBe("explicit");
  });

  test("clearing stops stamping", () => {
    setCurrentSessionId("session-1");
    clearCurrentSessionId();
    expect(Event({ type: "t", source: "s" }, {}).sessionId).toBeUndefined();
  });

  test("the session does not disturb the other defaults", () => {
    setCurrentSessionId("session-1");
    const event = Event({ type: "channel.follow", source: "twitch" }, { userName: "alice" });

    expect(event.specversion).toBe("1.0.0");
    expect(event.type).toBe("channel.follow");
    expect(event.source).toBe("twitch");
    expect(event.data).toEqual({ userName: "alice" });
  });
});

describe("missing-session warning", () => {
  test("warns once per gap rather than on every event", () => {
    Event({ type: "t", source: "s" }, {});
    Event({ type: "t", source: "s" }, {});

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("session.started");
  });

  test("stays quiet once a session is known", () => {
    setCurrentSessionId("session-1");
    Event({ type: "t", source: "s" }, {});

    expect(warnings).toHaveLength(0);
  });

  test("warns again for a later gap, so a lost subscription is not masked by an earlier one", () => {
    Event({ type: "t", source: "s" }, {});
    setCurrentSessionId("session-1");
    clearCurrentSessionId();
    Event({ type: "t", source: "s" }, {});

    expect(warnings).toHaveLength(2);
  });
});
