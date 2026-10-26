import {
  parseShoutoutEnqueueReply,
  SHOUTOUT_ENQUEUE_SUBJECT,
  type ShoutoutEnqueueTarget,
} from "@woofx3/common/cloudevents/Twitch/commands";
import { requestFailureKind } from "@woofx3/nats/src/errors";

/**
 * `queued`: the dashboard will send it in turn. `no_queue`: this engine's
 * Twitch link is its own, so there is no dashboard queue and the caller sends
 * the shoutout directly. Any failure to queue throws.
 */
export type EnqueueOutcome =
  | { kind: "queued"; position: number; alreadyQueued: boolean }
  | { kind: "no_queue"; reason: string };

export type EnqueueShoutout = (target: ShoutoutEnqueueTarget) => Promise<EnqueueOutcome>;

type NatsRequest = (subject: string, data: Uint8Array, opts?: { timeout?: number }) => Promise<{ data: Uint8Array }>;

/**
 * An `EnqueueShoutout` that asks the api service, the engine's one connection
 * to its dashboard.
 *
 * Only "nobody answers on the subject" falls back to a direct send. A timeout
 * does not: the dashboard may have queued the shoutout after the wait ran out,
 * and sending it directly as well would shout the user out twice.
 * `timeoutMs` is TWITCH_DEFAULTS.shoutoutEnqueueTimeoutMs outside tests.
 */
export function enqueueShoutoutOverNats(request: NatsRequest, timeoutMs: number): EnqueueShoutout {
  return async (target) => {
    let reply: { data: Uint8Array };
    try {
      reply = await request(SHOUTOUT_ENQUEUE_SUBJECT, new TextEncoder().encode(JSON.stringify(target)), {
        timeout: timeoutMs,
      });
    } catch (err) {
      const failure = requestFailureKind(err);
      if (failure === "no_responders") {
        return { kind: "no_queue", reason: "the api service is not running" };
      }
      if (failure === "timeout") {
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
  const parsed = parseShoutoutEnqueueReply(body);
  if (!parsed.ok) {
    throw new Error(`shoutout: the api service's queue reply ${parsed.error}`);
  }
  const reply = parsed.value;
  if ("error" in reply) {
    throw new Error(`shoutout: could not queue the shoutout: ${reply.error}`);
  }
  if ("unavailable" in reply) {
    return { kind: "no_queue", reason: reply.unavailable };
  }
  return { kind: "queued", position: reply.queued.position, alreadyQueued: reply.queued.alreadyQueued };
}
