import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { propagation, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import { TraceHarness } from "@woofx3/common/logging/TraceHarness";
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

describe("Event trace context", () => {
  const harness = TraceHarness.install();
  beforeEach(() => harness.reset());

  test("stamps traceparent from the active span, and it extracts to the same trace id", async () => {
    let traceId = "";
    let event: ReturnType<typeof Event> | undefined;
    await harness.inSpan("publish", (span) => {
      traceId = span.spanContext().traceId;
      event = Event({ type: "t", source: "s" }, {});
    });
    const encoded = JSON.parse(JSON.stringify(event));
    expect(encoded.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
    const extracted = propagation.extract(ROOT_CONTEXT, { traceparent: encoded.traceparent });
    expect(trace.getSpanContext(extracted)?.traceId).toBe(traceId);
  });

  test("an explicit traceparent is not overwritten", async () => {
    const explicit = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
    const event = await harness.inSpan("publish", () => Event({ type: "t", source: "s", traceparent: explicit }, {}));
    expect(event.traceparent).toBe(explicit);
    expect(event.tracestate).toBeUndefined();
  });

  test("omits the attributes when nothing is recording", () => {
    const encoded = JSON.parse(JSON.stringify(Event({ type: "t", source: "s" }, {})));
    expect("traceparent" in encoded).toBe(false);
    expect("tracestate" in encoded).toBe(false);
  });
});
