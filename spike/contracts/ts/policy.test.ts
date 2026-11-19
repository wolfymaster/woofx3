import { expect, test } from "bun:test";
import { lenient, strict } from "./validators";

const request = {
  action: "chat.send",
  target: { kind: "all" },
  payload: { message: "hi" },
  idempotencyKey: "k",
  requestedBy: { kind: "api", ref: "c" },
};
const reply = { ok: true, results: { twitch: { status: "delivered" } } };

test("a producer refuses an unknown request field at any depth", () => {
  const gateway = strict("platform-gateway/gateway-request.json");
  expect(gateway(request).ok).toBe(true);
  expect(gateway({ ...request, colour: "red" }).ok).toBe(false);
  expect(gateway({ ...request, payload: { message: "hi", colour: "red" } }).ok).toBe(false);
});

test("a consumer tolerates fields a newer producer added to a reply, but not missing or mistyped ones", () => {
  const read = lenient("platform-gateway/gateway-reply.json");
  expect(read({ ...reply, addedLater: 1 }).ok).toBe(true);
  expect(read({ ok: true, results: { twitch: { status: "delivered", addedLater: 1 } } }).ok).toBe(true);
  expect(read({ results: reply.results }).ok).toBe(false);
  expect(read({ ok: "yes", results: reply.results }).ok).toBe(false);
});

test("disjoint-field variants stay exclusive in both modes: a payload that matches two is refused", () => {
  const pin = { ...request, action: "chat.pin", payload: { messageId: "m", message: "x" } };
  expect(strict("platform-gateway/gateway-request.json")(pin).ok).toBe(false);
  expect(lenient("platform-gateway/gateway-request.json")(pin).ok).toBe(false);
});
