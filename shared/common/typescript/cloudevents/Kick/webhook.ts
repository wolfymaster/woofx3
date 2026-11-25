import { z } from "zod";

/**
 * The subject a Kick webhook delivery reaches the connectors Kick adapter on.
 * The api's `POST /webhooks/kick` sends Kick's headers and the raw body here
 * untouched; the adapter verifies Kick's signature itself, so nothing that
 * forwarded the delivery is trusted.
 */
export const KICK_WEBHOOK_SUBJECT = "engine.kick.webhook";

/**
 * How long the connectors host holds a delivery before answering for the
 * adapter. Below `KICK_WEBHOOK_REQUEST_TIMEOUT_MS`, so the api always gets a
 * reply rather than a timeout.
 */
export const KICK_WEBHOOK_SERVED_BUDGET_MS = 8_000;

/** How long the api waits for the adapter's reply to one delivery. */
export const KICK_WEBHOOK_REQUEST_TIMEOUT_MS = 9_000;

/** The largest delivery body the api forwards; Kick's bodies are a few KiB. */
export const KICK_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

/** Kick's webhook headers, as the api reads them. Must match `KickWebhookRequestSchema`. */
export const KICK_WEBHOOK_HEADERS = {
  messageId: "Kick-Event-Message-Id",
  subscriptionId: "Kick-Event-Subscription-Id",
  signature: "Kick-Event-Signature",
  timestamp: "Kick-Event-Message-Timestamp",
  eventType: "Kick-Event-Type",
  eventVersion: "Kick-Event-Version",
} as const;

export const KickWebhookRequestSchema = z.object({
  messageId: z.string().min(1),
  subscriptionId: z.string().min(1),
  signature: z.string().min(1),
  timestamp: z.string().min(1),
  eventType: z.string().min(1),
  eventVersion: z.string().min(1),
  /** The body bytes exactly as Kick signed them. */
  bodyBase64: z.string(),
});

export type KickWebhookRequest = z.infer<typeof KickWebhookRequestSchema>;

/**
 * - published: every event the delivery became is on the bus;
 * - duplicate: this delivery id was published before;
 * - ignored: valid, but nothing to publish (another channel's event, an unknown event type);
 * - malformed: headers or body are not a Kick delivery;
 * - bad_signature: Kick did not sign it;
 * - stale: its timestamp is too old or in the future;
 * - publish_failed: an event could not be published; Kick should retry;
 * - unavailable: the adapter cannot take deliveries right now; Kick should retry.
 */
export const KICK_WEBHOOK_REASONS = [
  "published",
  "duplicate",
  "ignored",
  "malformed",
  "bad_signature",
  "stale",
  "publish_failed",
  "unavailable",
] as const;

export type KickWebhookReason = (typeof KICK_WEBHOOK_REASONS)[number];

/** The HTTP status Kick gets for each reason: 2xx stops its retries, 5xx asks for one. */
export const KICK_WEBHOOK_STATUS: Readonly<Record<KickWebhookReason, KickWebhookStatus>> = {
  published: 200,
  duplicate: 200,
  ignored: 200,
  malformed: 400,
  bad_signature: 401,
  stale: 401,
  publish_failed: 500,
  unavailable: 503,
};

export type KickWebhookStatus = 200 | 400 | 401 | 500 | 503;

export interface KickWebhookReply {
  status: KickWebhookStatus;
  reason: KickWebhookReason;
}

export function kickWebhookReply(reason: KickWebhookReason): KickWebhookReply {
  return { status: KICK_WEBHOOK_STATUS[reason], reason };
}

export const KickWebhookReplySchema = z.object({
  status: z.union([z.literal(200), z.literal(400), z.literal(401), z.literal(500), z.literal(503)]),
  reason: z.enum(KICK_WEBHOOK_REASONS),
});
