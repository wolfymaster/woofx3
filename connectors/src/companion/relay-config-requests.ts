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
      handle: async (request) => encode(await this.handle(request)),
      errorReply: (code, message) => encode({ status: "failed", error: `${code}: ${message}` }),
    };
  }

  /** Stores the configuration, or clears it; a failed write is answered, not thrown. */
  async handle(request: RelayConfigSetRequest): Promise<RelayConfigSetReply> {
    const { config } = request;
    try {
      await this.deps.source.setConfig(config);
    } catch (error) {
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
