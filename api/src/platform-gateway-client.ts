import {
  type GatewayRequest,
  PLATFORM_GATEWAY_REPLY_TYPES,
  PLATFORM_GATEWAY_SUBJECTS,
  type PlatformGatewayResult,
  parseGatewayReply,
  parseGatewayRequest,
} from "@woofx3/api/platform-gateway";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";

type Requester = Pick<NATSClient, "request">;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Matched by name and message, as the NATS client raises them. */
function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.message === "timeout");
}

function isNoResponders(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  const cause = err.cause instanceof Error ? err.cause.name : "";
  return cause === "NoResponders" || err.message.includes("no responders");
}

export interface PlatformGatewayClientDeps {
  nats: Requester | null;
  logger: SharedLogger;
  timeoutMs: number;
}

/**
 * Sends one request to the platform gateway in connectors and reads its
 * reply. Never throws: every way of not getting the gateway's answer is a
 * result with its own code, since an RPC error would lose the code. A
 * `timeout` means the request may still have reached a platform.
 */
export class PlatformGatewayClient {
  constructor(private readonly deps: PlatformGatewayClientDeps) {
    if (!Number.isInteger(deps.timeoutMs) || deps.timeoutMs <= 0) {
      throw new Error(`PlatformGatewayClient: timeoutMs must be a positive integer, got ${deps.timeoutMs}`);
    }
  }

  async send(request: GatewayRequest): Promise<PlatformGatewayResult> {
    const checked = parseGatewayRequest(request);
    if (!checked.ok) {
      return { ok: false, code: "invalid", error: `${checked.error.field}: ${checked.error.problem}` };
    }
    const { nats, logger, timeoutMs } = this.deps;
    if (!nats) {
      return { ok: false, code: "unavailable", error: "The platform gateway cannot be reached: no message bus" };
    }
    let reply: { data: Uint8Array };
    try {
      reply = await nats.request(
        PLATFORM_GATEWAY_SUBJECTS.send,
        new TextEncoder().encode(JSON.stringify(checked.value)),
        { timeout: timeoutMs }
      );
    } catch (err) {
      if (isTimeout(err)) {
        logger.warn("platform gateway did not answer in time", {
          action: request.action,
          idempotencyKey: request.idempotencyKey,
          timeoutMs,
        });
        return {
          ok: false,
          code: "timeout",
          error: `The platform gateway did not answer within ${timeoutMs / 1000}s; the message may have been sent`,
        };
      }
      if (isNoResponders(err)) {
        logger.warn("platform gateway has no responders", {
          action: request.action,
          idempotencyKey: request.idempotencyKey,
        });
        return { ok: false, code: "unavailable", error: "The platform gateway is not running" };
      }
      logger.warn("platform gateway request failed", {
        action: request.action,
        idempotencyKey: request.idempotencyKey,
        error: errorMessage(err),
      });
      return { ok: false, code: "failed", error: `The platform gateway request failed: ${errorMessage(err)}` };
    }
    const result = readGatewayReply(reply.data);
    if (!result.ok) {
      logger.warn("platform gateway reply broke the contract", {
        action: request.action,
        idempotencyKey: request.idempotencyKey,
        problem: result.error,
      });
    }
    return result;
  }
}

/** The gateway's CloudEvent reply as a result; an unreadable one is `failed`, since the request may have acted. */
export function readGatewayReply(raw: Uint8Array): PlatformGatewayResult {
  let envelope: { type?: unknown; data?: unknown };
  try {
    envelope = JSON.parse(new TextDecoder().decode(raw)) as { type?: unknown; data?: unknown };
  } catch {
    return { ok: false, code: "failed", error: "The platform gateway sent an unreadable reply" };
  }
  if (typeof envelope !== "object" || envelope === null || envelope.type !== PLATFORM_GATEWAY_REPLY_TYPES.send) {
    return { ok: false, code: "failed", error: "The platform gateway sent an unexpected reply" };
  }
  const parsed = parseGatewayReply(envelope.data);
  if (!parsed.ok) {
    return {
      ok: false,
      code: "failed",
      error: `The platform gateway sent an unreadable reply: ${parsed.error.field}: ${parsed.error.problem}`,
    };
  }
  return { ok: true, reply: parsed.value };
}
