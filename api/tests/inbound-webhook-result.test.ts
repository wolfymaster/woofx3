import { describe, expect, test } from "bun:test";
import {
  MAX_EVENT_DATA_BYTES,
  MAX_EVENTS,
  MAX_RESPONSE_BODY_BYTES,
  validateWebhookHandlerResult,
} from "../src/inbound-webhook-result";

const ALLOWED = new Set(["store.order.created"]);

function reason(result: unknown): string {
  const checked = validateWebhookHandlerResult(result, ALLOWED);
  if (checked.ok) {
    throw new Error("expected the result to be rejected");
  }
  return checked.reason;
}

describe("validateWebhookHandlerResult", () => {
  test("accepts a status-only result as an empty response", () => {
    const checked = validateWebhookHandlerResult({ status: 204 }, ALLOWED);
    expect(checked).toEqual({ ok: true, response: { status: 204, headers: {}, body: "" }, events: [] });
  });

  test("sends a string body as text and an object body as JSON", () => {
    const text = validateWebhookHandlerResult({ status: 200, body: "abc" }, ALLOWED);
    const json = validateWebhookHandlerResult({ status: 200, body: { pong: true } }, ALLOWED);

    expect(text.ok && text.response).toEqual({
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: "abc",
    });
    expect(json.ok && json.response).toEqual({
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"pong":true}',
    });
  });

  test("keeps a content-type the handler chose and lowercases header names", () => {
    const checked = validateWebhookHandlerResult(
      { status: 200, body: "<ok/>", headers: { "Content-Type": "application/xml", "X-Delivery": "d-1" } },
      ALLOWED
    );
    expect(checked.ok && checked.response.headers).toEqual({ "content-type": "application/xml", "x-delivery": "d-1" });
  });

  test("passes declared events through", () => {
    const checked = validateWebhookHandlerResult(
      { status: 200, events: [{ type: "store.order.created", data: { orderId: "o-1" } }, { type: "store.order.created" }] },
      ALLOWED
    );
    expect(checked.ok && checked.events).toEqual([
      { type: "store.order.created", data: { orderId: "o-1" } },
      { type: "store.order.created", data: {} },
    ]);
  });

  test("rejects anything that is not an object", () => {
    for (const result of [undefined, null, "ok", 200, []]) {
      expect(reason(result)).toContain("must return an object");
    }
  });

  test("rejects unknown fields rather than ignoring them", () => {
    expect(reason({ status: 200, statusCode: 201 })).toContain("statusCode");
  });

  test("rejects a status outside 200-599", () => {
    for (const status of [199, 600, 200.5, "200"]) {
      expect(reason({ status })).toContain("status");
    }
  });

  test("rejects headers other than content-type and x-*", () => {
    for (const name of ["set-cookie", "location", "content-length", "bad header"]) {
      expect(reason({ status: 200, headers: { [name]: "v" } })).toContain("not allowed");
    }
    expect(reason({ status: 200, headers: { "x-a": 1 } })).toContain("must be a string");
  });

  test("rejects an oversized or unsupported body", () => {
    expect(reason({ status: 200, body: "a".repeat(MAX_RESPONSE_BODY_BYTES + 1) })).toContain("exceeds");
    expect(reason({ status: 200, body: 42 })).toContain("body must be");
  });

  test("rejects events that come with a non-2xx status", () => {
    expect(reason({ status: 401, events: [{ type: "store.order.created" }] })).toContain("2xx");
  });

  test("rejects an event type the module does not declare", () => {
    expect(reason({ status: 200, events: [{ type: "channel.cheer" }] })).toContain("channel.cheer");
  });

  test("rejects malformed or oversized events, and too many of them", () => {
    expect(reason({ status: 200, events: [{ type: "store.order.created", data: [] }] })).toContain("data must be");
    expect(reason({ status: 200, events: [{ type: "store.order.created", extra: 1 }] })).toContain("extra");
    expect(
      reason({ status: 200, events: [{ type: "store.order.created", data: { big: "a".repeat(MAX_EVENT_DATA_BYTES) } }] })
    ).toContain("exceeds");
    const many = Array.from({ length: MAX_EVENTS + 1 }, () => ({ type: "store.order.created" }));
    expect(reason({ status: 200, events: many })).toContain(`at most ${MAX_EVENTS}`);
  });
});
