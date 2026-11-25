import { describe, expect, test } from "bun:test";
import { KICK_WEBHOOK_MAX_BODY_BYTES } from "@woofx3/common/cloudevents/Kick/webhook";
import { TimeoutError } from "@woofx3/nats";
import { handleKickWebhook } from "../src/kick-webhook";

const SILENT = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never;

const KICK_HEADERS = {
  "Kick-Event-Message-Id": "01MSG",
  "Kick-Event-Subscription-Id": "01SUB",
  "Kick-Event-Signature": "c2lnbmF0dXJl",
  "Kick-Event-Message-Timestamp": "2026-11-25T10:00:00Z",
  "Kick-Event-Type": "channel.followed",
  "Kick-Event-Version": "1",
};

const BODY = '{"broadcaster":{"user_id":4242}}';

/** The connectors Kick adapter as a NATS responder: records what it was sent and answers `reply`. */
function adapter(reply: unknown | Error) {
  const sent: { subject: string; request: Record<string, unknown>; timeout: number }[] = [];
  return {
    sent,
    request: async (subject: string, data: Uint8Array, opts: { timeout: number }) => {
      sent.push({ subject, request: JSON.parse(new TextDecoder().decode(data)), timeout: opts.timeout });
      if (reply instanceof Error) {
        throw reply;
      }
      return { data: new TextEncoder().encode(typeof reply === "string" ? reply : JSON.stringify(reply)) };
    },
  };
}

function post(body: BodyInit, headers: Record<string, string> = KICK_HEADERS, method = "POST"): Request {
  return new Request("http://engine.test/webhooks/kick", {
    method,
    headers,
    body: method === "POST" ? body : undefined,
  });
}

describe("POST /webhooks/kick", () => {
  test("hands Kick's headers and the exact body bytes to the adapter", async () => {
    const responder = adapter({ status: 200, reason: "published" });
    const response = await handleKickWebhook(post(BODY), { request: responder.request, logger: SILENT });

    expect(response.status).toBe(200);
    expect(responder.sent).toEqual([
      {
        subject: "engine.kick.webhook",
        timeout: 9000,
        request: {
          messageId: "01MSG",
          subscriptionId: "01SUB",
          signature: "c2lnbmF0dXJl",
          timestamp: "2026-11-25T10:00:00Z",
          eventType: "channel.followed",
          eventVersion: "1",
          bodyBase64: Buffer.from(BODY).toString("base64"),
        },
      },
    ]);
  });

  const statuses: [reason: string, status: number][] = [
    ["published", 200],
    ["duplicate", 200],
    ["ignored", 200],
    ["malformed", 400],
    ["bad_signature", 401],
    ["stale", 401],
    ["publish_failed", 500],
    ["unavailable", 503],
  ];
  for (const [reason, status] of statuses) {
    test(`passes the adapter's ${reason} through as ${status}`, async () => {
      const response = await handleKickWebhook(post(BODY), {
        request: adapter({ status, reason }).request,
        logger: SILENT,
      });
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ reason });
    });
  }

  const unavailable: [name: string, reply: unknown | Error][] = [
    ["no answer in time", new TimeoutError()],
    ["an unreadable answer", "nope"],
    ["an answer that is not a reply", { status: 302, reason: "elsewhere" }],
  ];
  for (const [name, reply] of unavailable) {
    test(`${name} is a 503, so Kick retries`, async () => {
      const response = await handleKickWebhook(post(BODY), { request: adapter(reply).request, logger: SILENT });
      expect(response.status).toBe(503);
    });
  }

  test("a delivery missing a Kick header is a 400 and reaches nobody", async () => {
    const responder = adapter({ status: 200, reason: "published" });
    const { "Kick-Event-Signature": _, ...headers } = KICK_HEADERS;
    const response = await handleKickWebhook(post(BODY, headers), { request: responder.request, logger: SILENT });
    expect(response.status).toBe(400);
    expect(responder.sent).toEqual([]);
  });

  test("a signature that is not base64 is refused before a bus round trip", async () => {
    const responder = adapter({ status: 200, reason: "published" });
    const headers = { ...KICK_HEADERS, "Kick-Event-Signature": "not base64!" };
    const response = await handleKickWebhook(post(BODY, headers), { request: responder.request, logger: SILENT });
    expect(response.status).toBe(401);
    expect(responder.sent).toEqual([]);
  });

  test("a body over the cap is a 413 and reaches nobody", async () => {
    const responder = adapter({ status: 200, reason: "published" });
    const big = "x".repeat(KICK_WEBHOOK_MAX_BODY_BYTES + 1);
    const response = await handleKickWebhook(post(big), { request: responder.request, logger: SILENT });
    expect(response.status).toBe(413);
    expect(responder.sent).toEqual([]);
  });

  test("anything but POST is a 405", async () => {
    const response = await handleKickWebhook(post("", KICK_HEADERS, "GET"), {
      request: adapter({}).request,
      logger: SILENT,
    });
    expect(response.status).toBe(405);
  });
});
