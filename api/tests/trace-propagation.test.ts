import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { trace } from "@opentelemetry/api";
import { OPEN_REQUEST_GUARD_POLICY } from "@woofx3/common/http/request-guard";
import type { SharedLogger } from "@woofx3/common/logging";
import { TraceHarness } from "@woofx3/common/logging/trace-testing";
import { EngineEventStream } from "../src/engine-event-stream";
import type { ApiGateway } from "../src/gateway";
import { createHttpServer } from "../src/http";
import { DEFAULT_WEBHOOK_CLIENT_CONFIG, WebhookClient } from "../src/webhook-client";

const harness = TraceHarness.install();
const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as unknown as SharedLogger;
const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const PARENT_SPAN_ID = "b7ad6b7169203331";

let httpServer: ReturnType<typeof createHttpServer> | null = null;
let callbackServer: ReturnType<typeof Bun.serve> | null = null;

beforeEach(() => harness.reset());
afterEach(() => {
  httpServer?.stop(true);
  callbackServer?.stop(true);
  httpServer = null;
  callbackServer = null;
});

/** Starts the api's HTTP transport and returns its base URL and what each processing callback saw as its active trace id. */
function startApi(): { base: string; seen: string[] } {
  const seen: string[] = [];
  httpServer = createHttpServer({
    port: 0,
    hostname: "127.0.0.1",
    readiness: async () => ({ ready: true }) as never,
    health: () => ({ status: "ok" }) as never,
    logger,
    gateway: {} as ApiGateway,
    requestGuard: OPEN_REQUEST_GUARD_POLICY,
    onProcessingCallback: async () => {
      seen.push(trace.getActiveSpan()?.spanContext().traceId ?? "");
    },
    barkloaderWebhookSecret: null,
  });
  return { base: `http://127.0.0.1:${httpServer.port}`, seen };
}

describe("api HTTP ingress", () => {
  test("test_a_request_with_a_traceparent_continues_the_callers_trace", async () => {
    const { base, seen } = startApi();

    await fetch(`${base}/webhooks/barkloader/processing`, {
      method: "POST",
      headers: { traceparent: `00-${TRACE_ID}-${PARENT_SPAN_ID}-01` },
      body: "{}",
    });

    expect(seen).toEqual([TRACE_ID]);
    const [span] = harness.spans();
    expect(span?.kind).toBe(1);
    expect(span?.spanContext().traceId).toBe(TRACE_ID);
    expect(span?.parentSpanContext?.spanId).toBe(PARENT_SPAN_ID);
  });

  test.each([
    ["none", {}],
    ["a malformed one", { traceparent: "garbage" }],
  ])("test_a_request_with_%s_starts_a_new_root", async (_name, headers) => {
    const { base, seen } = startApi();

    await fetch(`${base}/webhooks/barkloader/processing`, { method: "POST", headers, body: "{}" });

    const [span] = harness.spans();
    expect(span?.parentSpanContext).toBeUndefined();
    expect(seen).toEqual([span?.spanContext().traceId ?? "unset"]);
  });
});

describe("outgoing webhooks", () => {
  test("test_a_callback_post_carries_the_traceparent_of_the_active_span", async () => {
    const received: Headers[] = [];
    callbackServer = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        received.push(req.headers);
        return new Response("{}", { status: 200 });
      },
    });
    const db = {
      listClients: mock(async () => ({
        clients: [
          {
            clientId: "ui",
            description: "ui",
            callbackUrl: `http://127.0.0.1:${callbackServer?.port}/cb`,
            callbackToken: "t",
          },
        ],
      })),
    };
    const webhooks = new WebhookClient(
      db as never,
      logger,
      new EngineEventStream(logger),
      DEFAULT_WEBHOOK_CLIENT_CONFIG,
      {
        ship: () => {},
      }
    );
    await webhooks.refreshCallbackUrls();

    let engineTraceId = "";
    await harness.inSpan("engine-work", async (span) => {
      engineTraceId = span.spanContext().traceId;
      await webhooks.send({ type: "workflow.deleted", workflowId: "w1" } as never);
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.get("traceparent")).toContain(engineTraceId);
    expect(received[0]?.get("authorization")).toBe("Bearer t");
  });
});
