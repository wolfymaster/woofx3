import { describe, expect, test } from "bun:test";
import { InvokeTimeoutError } from "@woofx3/barkloader";
import { inboundWebhooksRoutes } from "../src/routes/inbound-webhooks";

const WEBHOOK_TRIGGER = {
  manifestId: "orders",
  event: "webhook.example_store.orders",
  transport: "webhook",
  handler: "example_store:function:handle_order",
};
const ORDER_CREATED = {
  manifestId: "order_created",
  event: "store.order.created",
  transport: "eventbus",
  handler: "",
};
const TRIGGER_ID = "example_store:trigger:orders";

type Response = { status: number; headers: Record<string, string>; body: string };

function request(overrides: Record<string, unknown> = {}) {
  return {
    deliveryId: "delivery-1",
    method: "POST",
    headers: { "content-type": "application/json" },
    query: { a: "1" },
    rawBody: JSON.stringify({ id: "o-1" }),
    ...overrides,
  };
}

/**
 * The route is a mixin over the api's route host. It is bound to a stub that
 * records invocations and publishes, which is all it touches.
 */
function harness(
  opts: {
    triggers?: unknown[];
    connected?: boolean;
    handler?: (event: Record<string, unknown>) => Promise<unknown>;
    publishFails?: boolean;
  } = {}
) {
  const invocations: { func: string; event: Record<string, unknown> }[] = [];
  const published: { type: string; data: unknown; source?: string }[] = [];
  const ctx = {
    logger: { info() {}, debug() {}, warn() {}, error() {} },
    db: {
      async listTriggers(_createdByType: string, _createdByRef: string) {
        return opts.triggers ?? [WEBHOOK_TRIGGER, ORDER_CREATED];
      },
    },
    functions: {
      isConnected: () => opts.connected ?? true,
      async invoke(func: string, event: Record<string, unknown>) {
        invocations.push({ func, event });
        return opts.handler ? opts.handler(event) : { status: 200 };
      },
    },
    async publishEvent(type: string, data: unknown, _subject?: string, _platform?: string, source?: string) {
      if (opts.publishFails) {
        throw new Error("bus down");
      }
      published.push({ type, data, source });
    },
  };
  const route = inboundWebhooksRoutes.handleInboundWebhook as unknown as (
    triggerId: string,
    request: unknown
  ) => Promise<Response>;
  const handle = (triggerId = TRIGGER_ID, req: unknown = request()) => route.call(ctx, triggerId, req);
  return { handle, invocations, published };
}

describe("handleInboundWebhook", () => {
  test("runs the handler with the request as ctx.event.data", async () => {
    const { handle, invocations } = harness();
    await handle();

    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.func).toBe("example_store:function:handle_order");
    const event = invocations[0]?.event as Record<string, any>;
    expect(event.id).toBe("delivery-1");
    expect(event.type).toBe("webhook.example_store.orders");
    expect(event.data).toEqual({
      method: "POST",
      headers: { "content-type": "application/json" },
      query: { a: "1" },
      body: { id: "o-1" },
      rawBody: '{"id":"o-1"}',
    });
  });

  test("hands a non-JSON body over as null, with the raw text intact", async () => {
    const { handle, invocations } = harness();
    await handle(TRIGGER_ID, request({ rawBody: "a=b&c=d" }));

    const data = invocations[0]?.event.data as Record<string, unknown>;
    expect(data.body).toBeNull();
    expect(data.rawBody).toBe("a=b&c=d");
  });

  test("publishes the handler's events under the module's source before answering", async () => {
    const { handle, published } = harness({
      handler: async () => ({
        status: 200,
        body: { ok: true },
        events: [{ type: "store.order.created", data: { orderId: "o-1" } }],
      }),
    });
    const response = await handle();

    expect(published).toEqual([
      { type: "store.order.created", data: { orderId: "o-1" }, source: "module/example_store" },
    ]);
    expect(response).toEqual({ status: 200, headers: { "content-type": "application/json" }, body: '{"ok":true}' });
  });

  test("relays the handler's rejection and publishes nothing", async () => {
    const { handle, published } = harness({ handler: async () => ({ status: 401 }) });
    const response = await handle();

    expect(response.status).toBe(401);
    expect(published).toEqual([]);
  });

  test("refuses an event type the module does not declare, publishing nothing", async () => {
    const { handle, published } = harness({
      handler: async () => ({ status: 200, events: [{ type: "channel.cheer", data: {} }] }),
    });
    const response = await handle();

    expect(response.status).toBe(500);
    expect(published).toEqual([]);
  });

  test("404 for a malformed id, an unknown trigger, or a trigger that is not a webhook", async () => {
    expect((await harness().handle("orders")).status).toBe(404);
    expect((await harness({ triggers: [] }).handle()).status).toBe(404);
    expect((await harness().handle("example_store:trigger:order_created")).status).toBe(404);
  });

  test("500 when the handler throws", async () => {
    const { handle } = harness({
      handler: async () => {
        throw new Error("boom");
      },
    });
    expect((await handle()).status).toBe(500);
  });

  test("504 when the handler times out", async () => {
    const { handle } = harness({
      handler: async () => {
        throw new InvokeTimeoutError("example_store:function:handle_order");
      },
    });
    expect((await handle()).status).toBe(504);
  });

  test("503 without invoking anything when barkloader is not connected", async () => {
    const { handle, invocations } = harness({ connected: false });

    expect((await handle()).status).toBe(503);
    expect(invocations).toEqual([]);
  });

  test("503 when an event cannot be published", async () => {
    const { handle } = harness({
      publishFails: true,
      handler: async () => ({ status: 200, events: [{ type: "store.order.created" }] }),
    });
    expect((await handle()).status).toBe(503);
  });
});
