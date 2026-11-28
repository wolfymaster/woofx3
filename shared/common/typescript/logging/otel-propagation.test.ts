import { beforeEach, describe, expect, test } from "bun:test";
import { propagation, ROOT_CONTEXT, SpanKind, trace } from "@opentelemetry/api";
import { SamplingDecision } from "@opentelemetry/sdk-trace-base";
import { buildSampler } from "./otel";
import { TraceHarness } from "./TraceHarness";

const harness = TraceHarness.install();
const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";

describe("W3C propagation", () => {
  beforeEach(() => harness.reset());

  test("inject then extract yields the same trace id", async () => {
    let traceId = "";
    let carrier: Record<string, string> = {};
    await harness.inSpan("producer", (span) => {
      traceId = span.spanContext().traceId;
      carrier = harness.headers();
    });
    expect(carrier.traceparent).toContain(traceId);
    expect(trace.getSpanContext(propagation.extract(ROOT_CONTEXT, carrier))?.traceId).toBe(traceId);
  });

  test("baggage is not propagated", async () => {
    let carrier: Record<string, string> = {};
    await harness.inSpan("producer", () => {
      carrier = harness.headers();
    });
    expect(Object.keys(carrier)).not.toContain("baggage");
  });

  test("a consumer span started from the extracted context is a child", async () => {
    let carrier: Record<string, string> = {};
    await harness.inSpan("producer", () => {
      carrier = harness.headers();
    });
    const parentCtx = propagation.extract(ROOT_CONTEXT, carrier);
    trace.getTracer("test").startSpan("consumer", { kind: SpanKind.CONSUMER }, parentCtx).end();
    const [producer, consumer] = harness.spans();
    expect(consumer.spanContext().traceId).toBe(producer.spanContext().traceId);
    expect(consumer.parentSpanContext?.spanId).toBe(producer.spanContext().spanId);
  });
});

describe("buildSampler", () => {
  const decide = (ratio: number, parent = ROOT_CONTEXT) =>
    buildSampler(ratio).shouldSample(parent, TRACE_ID, "x", SpanKind.SERVER, {}, []).decision;

  test("ratio 0 drops new roots and ratio 1 keeps them", () => {
    expect(decide(0)).toBe(SamplingDecision.NOT_RECORD);
    expect(decide(1)).toBe(SamplingDecision.RECORD_AND_SAMPLED);
  });

  test("a sampled remote parent is kept even at ratio 0", () => {
    const parent = trace.setSpanContext(ROOT_CONTEXT, {
      isRemote: true,
      spanId: "b7ad6b7169203331",
      traceFlags: 1,
      traceId: TRACE_ID,
    });
    expect(decide(0, parent)).toBe(SamplingDecision.RECORD_AND_SAMPLED);
  });

  test.each([-1, 2, Number.NaN])("rejects ratio %p", (ratio) => {
    expect(() => buildSampler(ratio)).toThrow("trace sampler ratio must be within 0..1");
  });
});
