import {
  EgressActionId,
  type GatewayReply,
  type GatewayRequest,
  PLATFORM_GATEWAY_REPLY_TYPES,
  PLATFORM_GATEWAY_SUBJECTS,
  parseGatewayReply,
  parseGatewayRequest,
} from "@woofx3/api/platform-gateway";
import { errorMessage, type Logger } from "../host/deps";
import type { ScopedBus } from "../host/scoped-bus";
import type { ChatReplier } from "./commands";
import type { ChatLine } from "./trust";

/**
 * The longest reply the dispatcher sends, in characters. Must match the
 * chat.send message maxLength in shared/common/contracts/platform-gateway.json;
 * a longer reply is cut rather than refused whole.
 */
export const REPLY_MAX_CHARS = 500;

/** The reply that loses its tail ends with this, so chat can tell it was cut. */
const CUT_MARK = "…";

/** The `requestedBy.ref` of every dispatcher send. */
export const DISPATCHER_REQUESTER_REF = "chat-dispatcher";

/** The idempotency key of a reply: one reply per line and command, however often it is retried. */
export function replyIdempotencyKey(line: ChatLine, commandName: string): string {
  return `dispatcher:${line.lineId}:${commandName}`;
}

/** The chat.send request that replies to `line`, threaded under it when the platform's id for it is known. */
export function replyRequest(line: ChatLine, commandName: string, text: string): GatewayRequest {
  return {
    action: EgressActionId.CHAT_SEND,
    target: {
      kind: "origin",
      origin:
        line.messageId === undefined
          ? { platform: line.platform }
          : { platform: line.platform, messageId: line.messageId },
    },
    payload: { message: cut(text) },
    idempotencyKey: replyIdempotencyKey(line, commandName),
    requestedBy: { kind: "dispatcher", ref: DISPATCHER_REQUESTER_REF },
  };
}

export interface GatewayReplierDeps {
  bus: Pick<ScopedBus, "request">;
  /** How long a reply waits for the gateway; at least the gateway's own callers' timeout. */
  timeoutMs: number;
  logger: Logger;
}

/**
 * Replies through the platform gateway on platform.gateway.send, to the
 * platform the line came from. Nothing is retried: the gateway's outcome is
 * logged, and a chatter can say the command again.
 */
export class GatewayReplier implements ChatReplier {
  constructor(private readonly deps: GatewayReplierDeps) {}

  async reply(line: ChatLine, commandName: string, text: string): Promise<void> {
    const request = replyRequest(line, commandName, text);
    const checked = parseGatewayRequest(request);
    if (!checked.ok) {
      this.deps.logger.error("a command reply is not a valid gateway request; not sent", {
        command: commandName,
        field: checked.error.field,
        problem: checked.error.problem,
      });
      return;
    }
    let raw: { data: Uint8Array };
    try {
      raw = await this.deps.bus.request(PLATFORM_GATEWAY_SUBJECTS.send, encoder.encode(JSON.stringify(request)), {
        timeout: this.deps.timeoutMs,
      });
    } catch (error) {
      this.deps.logger.warn("a command reply got no answer from the platform gateway", {
        command: commandName,
        platform: line.platform,
        error: errorMessage(error),
      });
      return;
    }
    const reply = readReply(raw.data);
    if (!reply.ok) {
      this.deps.logger.error("the platform gateway answered a command reply with something unreadable", {
        command: commandName,
        problem: reply.problem,
      });
      return;
    }
    if (!reply.value.ok) {
      this.deps.logger.warn("the platform gateway did not deliver a command reply", {
        command: commandName,
        platform: line.platform,
        error: reply.value.error,
        results: reply.value.results,
      });
    }
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type ReadReply = { ok: true; value: GatewayReply } | { ok: false; problem: string };

function readReply(data: Uint8Array): ReadReply {
  let envelope: unknown;
  try {
    envelope = JSON.parse(decoder.decode(data));
  } catch (error) {
    return { ok: false, problem: `not JSON: ${errorMessage(error)}` };
  }
  if (typeof envelope !== "object" || envelope === null || !("type" in envelope) || !("data" in envelope)) {
    return { ok: false, problem: "not a CloudEvent" };
  }
  if (envelope.type !== PLATFORM_GATEWAY_REPLY_TYPES.send) {
    return { ok: false, problem: `unexpected type ${JSON.stringify(envelope.type)}` };
  }
  const parsed = parseGatewayReply(envelope.data);
  if (!parsed.ok) {
    return { ok: false, problem: `${parsed.error.field} ${parsed.error.problem}` };
  }
  return { ok: true, value: parsed.value };
}

/** Cuts by code point, so a cut never splits a character. */
function cut(text: string): string {
  const points = [...text];
  if (points.length <= REPLY_MAX_CHARS) {
    return text;
  }
  return points.slice(0, REPLY_MAX_CHARS - 1).join("") + CUT_MARK;
}
