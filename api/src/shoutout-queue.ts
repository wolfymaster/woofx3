import {
  EngineRequestType,
  type ShoutoutEnqueueRequestedEvent,
  type ShoutoutEnqueueRequestedResponse,
} from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import type { DashboardRequester } from "./twitch-token-source";

/**
 * NATS subject the twitch service asks on to queue a shoutout on the
 * dashboard. Must match `SHOUTOUT_ENQUEUE_SUBJECT` in
 * twitch/src/lib/shoutoutQueue.ts. The request is a `ShoutoutTarget`; the
 * reply is a `ShoutoutEnqueueReply`.
 */
export const SHOUTOUT_ENQUEUE_SUBJECT = "engine.shoutout.enqueue";

export type ShoutoutTarget = Omit<ShoutoutEnqueueRequestedEvent, "type">;

/**
 * `queued`: the dashboard has it. `unavailable`: there is no dashboard queue
 * for this engine, because its Twitch link is its own, so the caller sends
 * the shoutout itself. `error`: there is a queue but it could not be reached
 * or refused, and the shoutout was not sent.
 */
export type ShoutoutEnqueueReply =
  | { queued: { position: number; alreadyQueued: boolean } }
  | { unavailable: string }
  | { error: string };

export interface ShoutoutQueueDeps {
  /** The dashboard the Twitch link came from; `TwitchTokenSource.linkedDashboardClientId`. */
  linkedDashboardClientId(): Promise<string | null>;
  dashboard(): DashboardRequester | null;
}

/** Ask the dashboard that holds the Twitch link to queue `target`. Never throws. */
export async function enqueueShoutout(target: unknown, deps: ShoutoutQueueDeps): Promise<ShoutoutEnqueueReply> {
  const request = asTarget(target);
  if (!request) {
    return { error: "shoutout request needs twitchUserId, login and displayName" };
  }
  try {
    const clientId = await deps.linkedDashboardClientId();
    if (!clientId) {
      return { unavailable: "Twitch is not linked through a dashboard" };
    }
    const dashboard = deps.dashboard();
    if (!dashboard) {
      return { error: "no dashboard connection to queue the shoutout on" };
    }
    const answer = parseEnqueueResponse(
      await dashboard.request({ type: EngineRequestType.SHOUTOUT_ENQUEUE_REQUESTED, ...request }, clientId)
    );
    if (!answer.queued) {
      return { error: "the dashboard has no Twitch link to send shoutouts with" };
    }
    return { queued: { position: answer.position, alreadyQueued: answer.alreadyQueued } };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Answer the twitch service's shoutout requests on `SHOUTOUT_ENQUEUE_SUBJECT`. */
export async function serveShoutoutQueue(
  nats: NATSClient,
  deps: ShoutoutQueueDeps,
  logger: SharedLogger
): Promise<void> {
  await nats.subscribe(SHOUTOUT_ENQUEUE_SUBJECT, async (msg: Msg) => {
    let target: unknown = null;
    try {
      target = msg.json();
    } catch {
      // Refused below as a malformed request.
    }
    const reply = await enqueueShoutout(target, deps);
    if ("error" in reply) {
      logger.warn("shoutout enqueue failed", { error: reply.error });
    }
    msg.respond(new TextEncoder().encode(JSON.stringify(reply)));
  });
}

/** The dashboard's answer, refusing anything that is not one. */
export function parseEnqueueResponse(body: unknown): ShoutoutEnqueueRequestedResponse {
  if (typeof body !== "object" || body === null || !("queued" in body)) {
    throw new Error("the dashboard's answer has no queued field");
  }
  const { queued, position, alreadyQueued, reason } = body as Record<string, unknown>;
  if (queued === false) {
    if (reason !== "not_linked") {
      throw new Error("the dashboard refused the shoutout without a known reason");
    }
    return { queued: false, reason };
  }
  if (queued !== true || typeof position !== "number" || !Number.isInteger(position) || position < 1) {
    throw new Error("the dashboard's answer is malformed");
  }
  return { queued: true, position, alreadyQueued: alreadyQueued === true };
}

function asTarget(value: unknown): ShoutoutTarget | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { twitchUserId, login, displayName, profileImageUrl, broadcasterType } = value as Record<string, unknown>;
  if (
    typeof twitchUserId !== "string" ||
    !twitchUserId ||
    typeof login !== "string" ||
    !login ||
    typeof displayName !== "string"
  ) {
    return null;
  }
  return {
    twitchUserId,
    login,
    displayName: displayName || login,
    ...(typeof profileImageUrl === "string" && profileImageUrl ? { profileImageUrl } : {}),
    ...(typeof broadcasterType === "string" ? { broadcasterType } : {}),
  };
}
