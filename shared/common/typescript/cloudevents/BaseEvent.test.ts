import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import Event from "./BaseEvent";
import { clearCurrentSessionId, setCurrentSessionId } from "./session";

// A session is set throughout so the missing-session warning, which is tested
// in session.test.ts, does not print here.
beforeEach(() => {
  setCurrentSessionId("session-1");
});

afterEach(() => {
  clearCurrentSessionId();
});

describe("Event envelope defaults", () => {
  test("generates a unique id per event", () => {
    const first = Event({ type: "channel.follow", source: "twitch" }, {});
    const second = Event({ type: "channel.follow", source: "twitch" }, {});

    expect(first.id).not.toBe(second.id);
    expect(first.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  // `source` + `id` is the CloudEvents uniqueness key. A shared default would
  // leave every event from a source indistinguishable, so no consumer could
  // dedupe and a module reading `ctx.event.id` would see one value forever.
  test("never emits a placeholder id", () => {
    expect(Event({ type: "user.message", source: "chat" }, {}).id).not.toBe("unknown");
  });

  test("an explicit id wins, so a caller can carry a correlation id through", () => {
    expect(Event({ type: "t", source: "s", id: "correlation-1" }, {}).id).toBe("correlation-1");
  });

  test("defaults the rest of the envelope", () => {
    const event = Event({ type: "channel.follow", source: "twitch" }, { userName: "alice" });

    expect(event.specversion).toBe("1.0.0");
    expect(event.type).toBe("channel.follow");
    expect(event.source).toBe("twitch");
    expect(event.data).toEqual({ userName: "alice" });
    expect(event.time).toBeInstanceOf(Date);
  });

  // The wire form is what consumers parse, and `time` only becomes an ISO
  // string by way of JSON.stringify.
  test("serializes to the envelope consumers parse", () => {
    const encoded = JSON.parse(JSON.stringify(Event({ type: "channel.follow", source: "twitch" }, {})));

    expect(encoded.specversion).toBe("1.0.0");
    expect(typeof encoded.id).toBe("string");
    expect(typeof encoded.time).toBe("string");
    expect(encoded.sessionId).toBe("session-1");
  });
});
