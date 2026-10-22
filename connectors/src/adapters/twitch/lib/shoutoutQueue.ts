/**
 * NATS subject the api service answers by queueing a shoutout on the
 * dashboard. Must match `SHOUTOUT_ENQUEUE_SUBJECT` in api/src/shoutout-queue.ts.
 */
export const SHOUTOUT_ENQUEUE_SUBJECT = "engine.shoutout.enqueue";

/**
 * How long to wait for the api service, which waits up to 5s for the
 * dashboard. Under the 10s a module's `ctx.twitch` call waits for this
 * service, so a slow dashboard surfaces as this error rather than as the
 * sandbox's own timeout.
 */
const ENQUEUE_TIMEOUT_MS = 8_000;

export interface ShoutoutTarget {
  twitchUserId: string;
  login: string;
  displayName: string;
  profileImageUrl?: string;
  broadcasterType?: string;
}

/**
 * `queued`: the dashboard will send it in turn. `no_queue`: this engine's
 * Twitch link is its own, so there is no dashboard queue and the caller sends
 * the shoutout directly. Any failure to queue throws.
 */
export type EnqueueOutcome =
  | { kind: "queued"; position: number; alreadyQueued: boolean }
  | { kind: "no_queue"; reason: string };

export type EnqueueShoutout = (target: ShoutoutTarget) => Promise<EnqueueOutcome>;

type NatsRequest = (subject: string, data: Uint8Array, opts?: { timeout?: number }) => Promise<{ data: Uint8Array }>;

/**
 * An `EnqueueShoutout` that asks the api service, the engine's one connection
 * to its dashboard.
 *
 * Only "nobody answers on the subject" falls back to a direct send. A timeout
 * does not: the dashboard may have queued the shoutout after the wait ran out,
 * and sending it directly as well would shout the user out twice.
 */
export function enqueueShoutoutOverNats(request: NatsRequest, timeoutMs = ENQUEUE_TIMEOUT_MS): EnqueueShoutout {
  return async (target) => {
    let reply: { data: Uint8Array };
    try {
      reply = await request(SHOUTOUT_ENQUEUE_SUBJECT, new TextEncoder().encode(JSON.stringify(target)), {
        timeout: timeoutMs,
      });
    } catch (err) {
      if (isNoResponders(err)) {
        return { kind: "no_queue", reason: "the api service is not running" };
      }
      if (isTimeout(err)) {
        throw new Error(
          "shoutout: the dashboard did not confirm the shoutout was queued in time; check the shoutout queue before trying again"
        );
      }
      throw err;
    }
    return readReply(JSON.parse(new TextDecoder().decode(reply.data)));
  };
}

function readReply(body: unknown): EnqueueOutcome {
  if (typeof body !== "object" || body === null) {
    throw new Error("shoutout: the api service's queue reply is not an object");
  }
  const { queued, unavailable, error } = body as Record<string, unknown>;
  if (typeof error === "string") {
    throw new Error(`shoutout: could not queue the shoutout: ${error}`);
  }
  if (typeof unavailable === "string") {
    return { kind: "no_queue", reason: unavailable };
  }
  if (typeof queued === "object" && queued !== null) {
    const { position, alreadyQueued } = queued as Record<string, unknown>;
    if (typeof position === "number") {
      return { kind: "queued", position, alreadyQueued: alreadyQueued === true };
    }
  }
  throw new Error("shoutout: the api service's queue reply is malformed");
}

/** The NATS client's request failures, told apart by name and message, as woofwoofwoof does. */
function isTimeout(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  return name === "TimeoutError" || message === "timeout" || message === "TIMEOUT";
}

function isNoResponders(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause.name : "";
  return cause === "NoResponders" || message.includes("no responders") || message.includes("503");
}
