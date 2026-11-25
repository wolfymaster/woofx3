import {
  type KickWebhookReply,
  KickWebhookRequestSchema,
  kickWebhookReply,
} from "@woofx3/common/cloudevents/Kick/webhook";
import type { SchemaStreamStatusObserved } from "@woofx3/common/cloudevents/messages.gen";
import type PlatformEvents from "@woofx3/common/cloudevents/Twitch";
import type { BoundedMap } from "../../chat/bounded-map";
import { type Clock, errorMessage, type Logger } from "../../host/deps";
import { type NormaliseContext, normaliseKickDelivery } from "./lib/events";
import type { SignatureVerdict, SignedDelivery } from "./lib/signature";

/**
 * What the adapter remembers about deliveries across its restarts (the
 * module's host state; lost on a process restart):
 * - delivered: ids whose every event is published;
 * - published: how many of a delivery's events are on the bus, so a retry
 *   after a partial failure resumes after them instead of repeating them;
 * - inFlight: deliveries being processed now, so a concurrent copy of one
 *   waits for it instead of publishing it a second time.
 */
export interface DeliveryMemory {
  delivered: BoundedMap<string, true>;
  published: BoundedMap<string, number>;
  inFlight: Map<string, Promise<KickWebhookReply>>;
}

export interface KickIngestDeps {
  verify(delivery: SignedDelivery): Promise<SignatureVerdict>;
  clock: Clock;
  logger: Logger;
  /** A delivery whose timestamp is further than this from the clock, either way, is dropped. */
  maxSkewMs: number;
  memory: DeliveryMemory;
  /** The linked broadcaster; another channel's delivery is acknowledged and dropped. */
  broadcasterUserId: string;
  normalise: Omit<NormaliseContext, "deliveryId" | "events">;
  /**
   * The builder for one delivery's events. Their ids derive from the
   * delivery id and their order, so a retry rebuilds the same ids and a
   * consumer that saw one already can drop it.
   */
  eventsFor(deliveryId: string): PlatformEvents;
  publish(subject: string, data: Uint8Array): Promise<void>;
  /** Told after a stream status delivery is published. */
  liveChanged(status: SchemaStreamStatusObserved): void;
  /** Told after a redemption's event is published, so its later updates publish nothing. */
  redemptionPublished(redemptionId: string): void;
}

/**
 * One webhook delivery, in the order that keeps Kick's retries useful: a
 * delivery is acknowledged only once every event it became is on the bus,
 * and remembered as delivered only then, so a retry after a failed publish
 * publishes each event once. Anything Kick did not sign is refused before its
 * body is read. A signed delivery too old to act on is acknowledged and
 * dropped: refusing it would count against the subscription, and Kick
 * unsubscribes an app from events it keeps failing.
 */
export async function ingestKickDelivery(request: Uint8Array, deps: KickIngestDeps): Promise<KickWebhookReply> {
  const parsedRequest = parseRequest(request);
  if (parsedRequest === null) {
    return kickWebhookReply("malformed");
  }
  const { delivery, eventType, eventVersion } = parsedRequest;

  const verdict = await deps.verify(delivery);
  if (verdict === "unavailable") {
    deps.logger.warn("kick: no public key to verify a delivery with; Kick will retry it", {
      messageId: delivery.messageId,
    });
    return kickWebhookReply("unavailable");
  }
  if (verdict === "invalid") {
    deps.logger.warn("kick: refused a delivery Kick did not sign", { messageId: delivery.messageId, eventType });
    return kickWebhookReply("bad_signature");
  }

  const sentAt = Date.parse(delivery.timestamp);
  if (Number.isNaN(sentAt) || Math.abs(deps.clock.now() - sentAt) > deps.maxSkewMs) {
    deps.logger.info("kick: dropped a signed delivery outside the accepted time window", {
      messageId: delivery.messageId,
      timestamp: delivery.timestamp,
    });
    return kickWebhookReply("stale");
  }

  const { memory } = deps;
  const running = memory.inFlight.get(delivery.messageId);
  if (running !== undefined) {
    const first = await running;
    return memory.delivered.get(delivery.messageId) === undefined ? first : kickWebhookReply("duplicate");
  }
  if (memory.delivered.get(delivery.messageId) !== undefined) {
    return kickWebhookReply("duplicate");
  }
  const processing = processDelivery(delivery, eventType, eventVersion, deps);
  memory.inFlight.set(delivery.messageId, processing);
  try {
    return await processing;
  } finally {
    memory.inFlight.delete(delivery.messageId);
  }
}

/** A verified, in-window delivery that is not yet published: normalise and publish it. */
async function processDelivery(
  delivery: SignedDelivery,
  eventType: string,
  eventVersion: string,
  deps: KickIngestDeps
): Promise<KickWebhookReply> {
  const { memory } = deps;

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(delivery.body));
  } catch {
    deps.logger.warn("kick: a signed delivery's body is not JSON", { messageId: delivery.messageId, eventType });
    return kickWebhookReply("malformed");
  }
  const broadcaster = broadcasterOf(body);
  if (broadcaster !== deps.broadcasterUserId) {
    // Never answered with an error: Kick unsubscribes an app from events it keeps failing.
    deps.logger.warn("kick: ignored a delivery for another channel", {
      messageId: delivery.messageId,
      eventType,
      broadcaster: broadcaster ?? "(none)",
    });
    return kickWebhookReply("ignored");
  }

  let result: ReturnType<typeof normaliseKickDelivery>;
  try {
    result = normaliseKickDelivery(eventType, eventVersion, body, {
      ...deps.normalise,
      events: deps.eventsFor(delivery.messageId),
      deliveryId: delivery.messageId,
    });
  } catch (err) {
    deps.logger.warn("kick: a delivery's events do not fit their contract", {
      messageId: delivery.messageId,
      eventType,
      err: errorMessage(err),
    });
    return kickWebhookReply("malformed");
  }
  if (result.kind === "malformed") {
    deps.logger.warn("kick: a delivery's body is not its event's shape", {
      messageId: delivery.messageId,
      eventType,
      detail: result.detail,
    });
    return kickWebhookReply("malformed");
  }
  if (result.kind === "ignored") {
    deps.logger.debug("kick: nothing to publish for a delivery", { eventType, eventVersion, reason: result.reason });
    memory.delivered.set(delivery.messageId, true);
    return kickWebhookReply("ignored");
  }

  const alreadyPublished = memory.published.get(delivery.messageId) ?? 0;
  for (const [index, [subject, data]] of result.events.entries()) {
    if (index < alreadyPublished) {
      continue;
    }
    try {
      await deps.publish(subject, data);
      memory.published.set(delivery.messageId, index + 1);
    } catch (err) {
      deps.logger.error("kick: could not publish a delivery's event; Kick will retry it", {
        messageId: delivery.messageId,
        subject,
        err: errorMessage(err),
      });
      return kickWebhookReply("publish_failed");
    }
  }
  if (result.live !== undefined) {
    deps.liveChanged(result.live);
  }
  if (result.redemptionId !== undefined) {
    deps.redemptionPublished(result.redemptionId);
  }
  memory.delivered.set(delivery.messageId, true);
  memory.published.delete(delivery.messageId);
  return kickWebhookReply("published");
}

function parseRequest(
  request: Uint8Array
): { delivery: SignedDelivery; eventType: string; eventVersion: string } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(request));
  } catch {
    return null;
  }
  const parsed = KickWebhookRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  let body: Uint8Array;
  try {
    body = Uint8Array.from(atob(parsed.data.bodyBase64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  return {
    delivery: {
      messageId: parsed.data.messageId,
      timestamp: parsed.data.timestamp,
      signature: parsed.data.signature,
      body,
    },
    eventType: parsed.data.eventType,
    eventVersion: parsed.data.eventVersion,
  };
}

/** `broadcaster.user_id` as a string, or null when the body has none. */
function broadcasterOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const broadcaster = (body as { broadcaster?: unknown }).broadcaster;
  if (typeof broadcaster !== "object" || broadcaster === null) {
    return null;
  }
  const id = (broadcaster as { user_id?: unknown }).user_id;
  return typeof id === "number" && Number.isInteger(id) ? String(id) : null;
}
