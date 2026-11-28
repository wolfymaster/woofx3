import { beforeEach, describe, expect, test } from "bun:test";
import type { Msg as NatsCoreMsg } from "@nats-io/nats-core";
import { trace } from "@opentelemetry/api";
import Event from "@woofx3/common/cloudevents/BaseEvent";
import { MetricsHarness } from "@woofx3/common/logging/metrics-testing";
import { TraceHarness } from "@woofx3/common/logging/trace-testing";
import { consumeMessages } from "./client";
import { MessageProcessMetrics } from "./message-metrics";
import { extractTraceContext } from "./msg";

const logger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };
const harness = TraceHarness.install();
const metrics = new MessageProcessMetrics(new MetricsHarness().meter);

async function* messages(...payloads: string[]): AsyncIterable<NatsCoreMsg> {
  for (const payload of payloads) {
    yield { subject: "alerts.a", data: new TextEncoder().encode(payload) } as unknown as NatsCoreMsg;
  }
}

async function consume(payload: string, handler: () => void | Promise<void> = () => {}): Promise<void> {
  await consumeMessages("alerts.>", messages(payload), handler, logger, metrics);
  await Bun.sleep(0);
}

describe("NATS consumer tracing", () => {
  beforeEach(() => harness.reset());

  test("test_a_handler_runs_in_a_consumer_span_in_the_publishers_trace", async () => {
    let payload = "";
    let published = "";
    await harness.inSpan("publish", (span) => {
      published = span.spanContext().traceId;
      payload = JSON.stringify(Event({ type: "alert", source: "api" }, {}));
    });
    let handlerTraceId = "";
    await consume(payload, () => {
      handlerTraceId = trace.getActiveSpan()?.spanContext().traceId ?? "";
    });

    expect(handlerTraceId).toBe(published);
    const consumer = harness.spans().find((span) => span.name === "alerts.> process");
    expect(consumer?.spanContext().traceId).toBe(published);
    expect(consumer?.parentSpanContext?.spanId).toBe(harness.spans()[0]?.spanContext().spanId);
  });

  test.each([
    ["no traceparent", JSON.stringify({ type: "alert" })],
    ["a malformed traceparent", JSON.stringify({ traceparent: "not-a-traceparent" })],
    ["a non-string traceparent", JSON.stringify({ traceparent: 7 })],
    ["a non-JSON payload", 'plain text with a "traceparent" in it'],
    ["a JSON scalar", '"traceparent"'],
    ["an empty payload", ""],
  ])("test_%s_starts_a_new_root_and_still_runs_the_handler", async (_name, payload) => {
    let ran = false;
    await consume(payload, () => {
      ran = true;
    });
    expect(ran).toBe(true);
    const [span] = harness.spans();
    expect(span?.parentSpanContext).toBeUndefined();
  });

  test("test_a_failing_handler_marks_the_span_and_ends_it", async () => {
    await consume("{}", () => {
      throw new Error("boom");
    });
    const [span] = harness.spans();
    expect(span?.status.code).toBe(2);
    expect(span?.events[0]?.name).toBe("exception");
  });

  test("test_extractTraceContext_reads_tracestate_too", () => {
    const traceparent = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
    const ctx = extractTraceContext(new TextEncoder().encode(JSON.stringify({ traceparent, tracestate: "a=b" })));
    expect(trace.getSpanContext(ctx)?.traceState?.serialize()).toBe("a=b");
  });
});
