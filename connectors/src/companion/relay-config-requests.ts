// Answers `engine.companion.relay_config.set`: the api forwarding a
// dashboard's `setRelayConfig`. The companion gateway is the one writer of
// `relay.config`, so the dashboard's configuration is stored here, behind the
// same lock as the writes a credential renewal makes.

import {
  COMPANION_RELAY_CONFIG_SET_SUBJECT,
  parseRelayConfigSetRequest,
  RELAY_CONFIG_SET_BUDGET_MS,
  type RelayConfigSetReply,
  type RelayConfigSetRequest,
} from "@woofx3/common/cloudevents/Relay/relay";
import { errorMessage, type Logger } from "../host/deps";
import { type ParseResult, parsed, parseFailed, type RawRequestSpec } from "../host/host-requests";
import { abortable } from "./abortable";
import type { RelayCredentialSource } from "./relay-credentials";

export const RELAY_CONFIG_SET_DEFAULTS = {
  /** How long storing a configuration may take before the host answers for it. */
  budgetMs: RELAY_CONFIG_SET_BUDGET_MS,
} as const;

export interface RelayConfigRequestsDeps {
  source: Pick<RelayCredentialSource, "setConfig">;
  logger: Logger;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class RelayConfigRequests {
  constructor(private readonly deps: RelayConfigRequestsDeps) {}

  get served(): ReadonlyArray<{ subject: string; budgetMs: number }> {
    return [{ subject: COMPANION_RELAY_CONFIG_SET_SUBJECT, budgetMs: RELAY_CONFIG_SET_DEFAULTS.budgetMs }];
  }

  /** For HostRequests.serveRequest: a raw JSON request and reply, no CloudEvent envelope. */
  spec(): RawRequestSpec<RelayConfigSetRequest> {
    return {
      subject: COMPANION_RELAY_CONFIG_SET_SUBJECT,
      budgetMs: RELAY_CONFIG_SET_DEFAULTS.budgetMs,
      replyMode: "raw",
      parse: parseRequest,
      handle: async (request, ctx) => encode(await this.handle(request, ctx.signal)),
      errorReply: (code, message) => encode({ status: "failed", error: `${code}: ${message}` }),
    };
  }

  /**
   * Stores the configuration, or clears it; a failed write is answered, not
   * thrown. When `signal` aborts first the answer is a failure saying the
   * write may still land, since it stays queued behind the lock.
   */
  async handle(request: RelayConfigSetRequest, signal: AbortSignal): Promise<RelayConfigSetReply> {
    const { config } = request;
    const write = this.deps.source.setConfig(config);
    try {
      await abortable(write, signal);
    } catch (error) {
      if (signal.aborted) {
        write.catch((late: unknown) => {
          this.deps.logger.warn("relay configuration not stored", { error: errorMessage(late) });
        });
        const message = "the budget ran out; the write may still land";
        this.deps.logger.warn("relay configuration not confirmed", { error: message });
        return { status: "failed", error: message };
      }
      const message = errorMessage(error);
      this.deps.logger.warn("relay configuration not stored", { error: message });
      return { status: "failed", error: message };
    }
    if (config === null) {
      this.deps.logger.info("relay configuration cleared");
    } else {
      this.deps.logger.info("relay configuration stored", {
        bridgeOrigin: config.bridgeOrigin,
        endpoints: config.endpoints.length,
      });
    }
    return { status: "stored" };
  }
}

function parseRequest(raw: Uint8Array): ParseResult<RelayConfigSetRequest> {
  let body: unknown;
  try {
    body = JSON.parse(decoder.decode(raw));
  } catch {
    return parseFailed("the request is not JSON");
  }
  const request = parseRelayConfigSetRequest(body);
  return request.ok ? parsed(request.value) : parseFailed(request.error);
}

function encode(reply: RelayConfigSetReply): Uint8Array {
  return encoder.encode(JSON.stringify(reply));
}
