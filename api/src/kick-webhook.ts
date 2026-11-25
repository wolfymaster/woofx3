import {
  KICK_WEBHOOK_HEADERS,
  KICK_WEBHOOK_MAX_BODY_BYTES,
  KICK_WEBHOOK_REQUEST_TIMEOUT_MS,
  KICK_WEBHOOK_SUBJECT,
  KickWebhookReplySchema,
  type KickWebhookRequest,
} from "@woofx3/common/cloudevents/Kick/webhook";
import type { SharedLogger } from "@woofx3/common/logging";
import { requestFailureKind } from "@woofx3/nats";

export interface KickWebhookDeps {
  request(subject: string, data: Uint8Array, opts: { timeout: number }): Promise<{ data: Uint8Array }>;
  logger: SharedLogger;
}

function answer(status: number, reason: string): Response {
  return Response.json({ reason }, { status, headers: { "Cache-Control": "no-store" } });
}

/** The body, or null once it grows past `max` bytes; stops reading there. */
async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  if (req.body === null) {
    return new Uint8Array();
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * `POST /webhooks/kick`: one Kick webhook delivery, from Kick itself or from
 * whatever relays it. Kick's headers and the raw body go to the connectors
 * Kick adapter untouched, which verifies Kick's signature, so nothing here
 * trusts the sender. The adapter's status goes back to the sender: a 2xx
 * stops Kick's retries, a 5xx asks for one. Anything that keeps the
 * delivery from the adapter is a 503, so Kick tries again.
 */
export async function handleKickWebhook(req: Request, deps: KickWebhookDeps): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > KICK_WEBHOOK_MAX_BODY_BYTES) {
    return answer(413, "too_large");
  }
  const body = await readCapped(req, KICK_WEBHOOK_MAX_BODY_BYTES);
  if (body === null) {
    return answer(413, "too_large");
  }

  const headers: Partial<Record<keyof typeof KICK_WEBHOOK_HEADERS, string>> = {};
  for (const [field, name] of Object.entries(KICK_WEBHOOK_HEADERS) as [keyof typeof KICK_WEBHOOK_HEADERS, string][]) {
    const value = req.headers.get(name);
    if (value === null || value.trim() === "") {
      deps.logger.warn("Refused a Kick webhook without its header", { header: name });
      return answer(400, "malformed");
    }
    headers[field] = value;
  }
  const delivery: KickWebhookRequest = {
    messageId: headers.messageId ?? "",
    subscriptionId: headers.subscriptionId ?? "",
    signature: headers.signature ?? "",
    timestamp: headers.timestamp ?? "",
    eventType: headers.eventType ?? "",
    eventVersion: headers.eventVersion ?? "",
    bodyBase64: Buffer.from(body).toString("base64"),
  };

  let reply: { data: Uint8Array };
  try {
    reply = await deps.request(KICK_WEBHOOK_SUBJECT, new TextEncoder().encode(JSON.stringify(delivery)), {
      timeout: KICK_WEBHOOK_REQUEST_TIMEOUT_MS,
    });
  } catch (err) {
    deps.logger.warn("No answer from the Kick adapter for a webhook; Kick will retry it", {
      messageId: delivery.messageId,
      failure: requestFailureKind(err),
    });
    return answer(503, "unavailable");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(reply.data));
  } catch {
    parsed = undefined;
  }
  const outcome = KickWebhookReplySchema.safeParse(parsed);
  if (!outcome.success) {
    deps.logger.error("The Kick adapter answered a webhook with something unreadable", {
      messageId: delivery.messageId,
    });
    return answer(503, "unavailable");
  }
  return answer(outcome.data.status, outcome.data.reason);
}
