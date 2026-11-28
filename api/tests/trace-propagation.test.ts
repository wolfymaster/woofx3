import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { trace } from "@opentelemetry/api";
import { EngineEventType } from "@woofx3/api/webhooks";
import { OPEN_REQUEST_GUARD_POLICY } from "@woofx3/common/http/request-guard";
import type { SharedLogger } from "@woofx3/common/logging";
import { TraceHarness } from "@woofx3/common/logging/TraceHarness";
import * as clientPb from "@woofx3/db/client.pb";
import type { RpcTransport } from "twirpscript";
import { Api } from "../src/api";
import { ClientAuth } from "../src/auth";
import { ClientSessions } from "../src/client-sessions";
import { DbClient } from "../src/db-client";
import { EngineEventStream } from "../src/engine-event-stream";
import { ApiGateway } from "../src/gateway";
import { createHttpServer } from "../src/http";
import { resolveRegistrationPolicy } from "../src/registration";
import { DEFAULT_WEBHOOK_CLIENT_CONFIG, WebhookClient } from "../src/webhook-client";

const harness = TraceHarness.install();
const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const PARENT_SPAN_ID = "b7ad6b7169203331";

const logger: SharedLogger = {
  child: () => logger,
  debug: () => {},
  error: () => {},
  fatal: () => {},
  getLevel: () => "info",
  info: () => {},
  setLevel: () => {},
  warn: () => {},
  withContext: () => logger,
};

/** A db-proxy client whose only answer is the given client list, over the real protobuf wire format. */
function dbWithClients(clients: Partial<clientPb.Client>[]): DbClient {
  const rpcTransport: RpcTransport = async () => {
    const body = clientPb.ListClientsResponse.encode({
      status: { code: "OK", message: "" },
      clients: clients.map((client) => ({ ...clientPb.Client.initialize(), ...client })),
    });
    return {
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
      json: async () => ({}),
      headers: new Headers(),
      ok: true,
      status: 200,
      text: async () => "",
    };
  };
  return new DbClient({ baseURL: "http://db-proxy.test", headers: {}, rpcTransport });
}

function gatewayOver(db: DbClient): ApiGateway {
  const api = new Api({
    db,
    nats: null,
    functions: null,
    barkloaderUrl: "http://barkloader.test",
    barkloaderKey: "test-barkloader-key-0123456789abcdef",
    sceneManagerUrl: "http://scene.test",
    apiUrl: "http://api.test",
    logger,
  });
  return new ApiGateway(
    api,
    new ClientAuth(db, logger, { ttlMs: 1000 }),
    db,
    logger,
    resolveRegistrationPolicy({}),
    new ClientSessions(logger),
    null
  );
}

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
    readiness: async () => ({
      ready: true,
      version: "test",
      migrations: { applied: null, latest: null, pending: null },
      services: { dbProxy: true, barkloader: true },
    }),
    health: () => ({
      status: "ok",
      name: null,
      region: null,
      version: "test",
      startedAt: "1970-01-01T00:00:00.000Z",
      uptimeSeconds: 0,
      live: null,
      capabilities: { schema: 1, enabled: [] },
    }),
    logger,
    gateway: gatewayOver(dbWithClients([])),
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
    const db = dbWithClients([
      {
        clientId: "ui",
        description: "ui",
        callbackUrl: `http://127.0.0.1:${callbackServer?.port}/cb`,
        callbackToken: "t",
      },
    ]);
    const webhooks = new WebhookClient(db, logger, new EngineEventStream(logger), DEFAULT_WEBHOOK_CLIENT_CONFIG, {
      ship: () => {},
    });
    await webhooks.refreshCallbackUrls();

    let engineTraceId = "";
    await harness.inSpan("engine-work", async (span) => {
      engineTraceId = span.spanContext().traceId;
      await webhooks.send({ type: EngineEventType.WORKFLOW_DELETED, workflowId: "w1" });
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.get("traceparent")).toContain(engineTraceId);
    expect(received[0]?.get("authorization")).toBe("Bearer t");
  });
});
