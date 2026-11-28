import { beforeEach, describe, expect, test } from "bun:test";
import { propagation, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import { MetricsHarness } from "@woofx3/common/logging/metrics-testing";
import { TraceHarness } from "@woofx3/common/logging/TraceHarness";
import type { RpcTransport } from "twirpscript";
import { instrumentTransport } from "./rpc-metrics";

const harness = TraceHarness.install();
const URL_OF = "http://db-proxy:8080/twirp/woofx3.db.Command/GetCommand";

describe("Twirp client tracing", () => {
  beforeEach(() => harness.reset());

  test("test_the_request_carries_a_traceparent_of_the_calls_client_span", async () => {
    let sent: Record<string, string> = {};
    const transport: RpcTransport = async (_url, opts) => {
      sent = opts.headers;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({}),
        text: async () => "{}",
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    };
    const instrumented = instrumentTransport(new MetricsHarness().meter, transport);

    let callerTraceId = "";
    await harness.inSpan("caller", async (span) => {
      callerTraceId = span.spanContext().traceId;
      await instrumented(URL_OF, { method: "POST", headers: { Authorization: "Bearer t" }, body: "{}" });
    });

    expect(sent.Authorization).toBe("Bearer t");
    const extracted = trace.getSpanContext(propagation.extract(ROOT_CONTEXT, sent));
    expect(extracted?.traceId).toBe(callerTraceId);
    const client = harness.spans().find((span) => span.name === "woofx3.db.Command/GetCommand");
    expect(extracted?.spanId).toBe(client?.spanContext().spanId);
    expect(client?.parentSpanContext?.traceId).toBe(callerTraceId);
  });

  test("test_a_failed_call_ends_its_span_as_an_error", async () => {
    const instrumented = instrumentTransport(new MetricsHarness().meter, async () => {
      throw new Error("connection refused");
    });
    await expect(instrumented(URL_OF, { method: "POST", headers: {}, body: "{}" })).rejects.toThrow();
    expect(harness.spans()[0]?.status.code).toBe(2);
  });
});
