import {
  type CapabilitiesReply,
  EgressActionId,
  type FieldOptionsReply,
  PLATFORM_DISPLAY_NAMES,
  PLATFORM_GATEWAY_REPLY_TYPES,
  PLATFORM_GATEWAY_SUBJECTS,
  type PlatformCapability,
  parseFieldOptionsRequest,
} from "@woofx3/api/platform-gateway";
import { platformAdapterId } from "../host/adapter";
import { type HostRequests, type ParseResult, parsed, parseFailed } from "../host/host-requests";
import type { ScopedBus } from "../host/scoped-bus";
import type { AdapterStatusSource } from "../host/served-subjects";
import type { EgressRegistry } from "./egress-registry";

export type DiscoveryAdapters = Pick<AdapterStatusSource, "status" | "link">;

export interface GatewayDiscoveryDeps {
  egress: EgressRegistry;
  adapters: DiscoveryAdapters;
  requests: HostRequests;
  /** Budget of each request to either discovery subject. */
  budgetMs: number;
  /** Display name per platform; defaults to the contract table. */
  displayNames?: Readonly<Record<string, string>>;
}

/**
 * Serves platform.gateway.capabilities and platform.gateway.field_options:
 * which platforms exist, what each can do and whether it is usable now.
 * Callers use it to offer only platforms that can perform an action.
 */
export class GatewayDiscovery {
  private readonly displayNames: Readonly<Record<string, string>>;

  constructor(private readonly deps: GatewayDiscoveryDeps) {
    if (!Number.isInteger(deps.budgetMs) || deps.budgetMs <= 0) {
      throw new Error(`GatewayDiscovery: budgetMs must be a positive integer, got ${deps.budgetMs}`);
    }
    this.displayNames = deps.displayNames ?? PLATFORM_DISPLAY_NAMES;
    for (const platform of deps.egress.platforms) {
      if (!this.displayNames[platform]) {
        throw new Error(`platform "${platform}" has no display name`);
      }
    }
  }

  /** The subjects and budgets served, for the host scope's grants and its shutdown bound. */
  get served(): ReadonlyArray<{ subject: string; budgetMs: number }> {
    return [
      { subject: PLATFORM_GATEWAY_SUBJECTS.capabilities, budgetMs: this.deps.budgetMs },
      { subject: PLATFORM_GATEWAY_SUBJECTS.fieldOptions, budgetMs: this.deps.budgetMs },
    ];
  }

  async serve(scope: ScopedBus): Promise<void> {
    await this.deps.requests.serveRequest<undefined, CapabilitiesReply>(scope, {
      subject: PLATFORM_GATEWAY_SUBJECTS.capabilities,
      budgetMs: this.deps.budgetMs,
      replyMode: "cloudevent",
      replyType: PLATFORM_GATEWAY_REPLY_TYPES.capabilities,
      // The request carries nothing; whatever a caller sends is ignored.
      parse: () => parsed(undefined),
      handle: async () => ({ platforms: this.capabilities() }),
      errorReply: (_code, message) => ({ error: message }),
    });
    await this.deps.requests.serveRequest<EgressActionId, FieldOptionsReply>(scope, {
      subject: PLATFORM_GATEWAY_SUBJECTS.fieldOptions,
      budgetMs: this.deps.budgetMs,
      replyMode: "cloudevent",
      replyType: PLATFORM_GATEWAY_REPLY_TYPES.fieldOptions,
      parse: parseRequest,
      handle: async (action) => this.fieldOptions(action),
      errorReply: (_code, message) => ({ error: message }),
    });
  }

  private capabilities(): PlatformCapability[] {
    return this.deps.egress.platforms.map((platform) => {
      const adapter = platformAdapterId(platform);
      const link = this.deps.adapters.link(adapter);
      return {
        id: platform,
        displayName: this.displayNames[platform] as string,
        state: this.deps.adapters.status(adapter).state,
        connected: link?.connected ?? false,
        enabled: link?.enabled ?? false,
        actions: Object.values(EgressActionId).filter((action) => this.deps.egress.supports(platform, action)),
      };
    });
  }

  /**
   * The platforms a select field can offer for `action`: connected, enabled
   * and able to perform it. `all` and `origin` are not listed, since the
   * field's manifest pins them.
   */
  private fieldOptions(action: EgressActionId): FieldOptionsReply {
    return this.capabilities()
      .filter((platform) => platform.connected && platform.enabled && platform.actions.includes(action))
      .map((platform) => ({ value: platform.id, label: platform.displayName }));
  }
}

const decoder = new TextDecoder();

/**
 * The request is `{ action }`. The api relays a module field's request as a
 * CloudEvent envelope, so `{ data: { action } }` is read the same way. A
 * refusal, such as an unknown action, becomes the reply's error.
 */
function parseRequest(raw: Uint8Array): ParseResult<EgressActionId> {
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(raw));
  } catch {
    return parseFailed("request is not JSON");
  }
  const request = parseFieldOptionsRequest(unwrap(value));
  if (!request.ok) {
    return parseFailed(`${request.error.field}: ${request.error.problem}`);
  }
  return parsed(request.value.action);
}

function unwrap(value: unknown): unknown {
  if (isRecord(value) && !("action" in value) && isRecord(value.data)) {
    return value.data;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
