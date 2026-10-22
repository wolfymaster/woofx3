import {
  EgressActionId,
  isEgressActionId,
  PLATFORM_DISPLAY_NAMES,
  PLATFORM_GATEWAY_SUBJECTS,
  type PlatformId,
} from "@woofx3/api/platform-gateway";
import type { AdapterState } from "../host/adapter";
import { platformAdapterId } from "../host/adapter";
import { type HostRequests, type ParseResult, parsed, parseFailed } from "../host/host-requests";
import type { ScopedBus } from "../host/scoped-bus";
import type { AdapterStatusSource } from "../host/served-subjects";
import type { EgressRegistry } from "./egress-registry";

/** The CloudEvent type of every platform.gateway.capabilities reply. */
export const GATEWAY_CAPABILITIES_RESULT_TYPE = "platform.gateway.capabilities.result";

/** The CloudEvent type of every platform.gateway.field_options reply. */
export const GATEWAY_FIELD_OPTIONS_RESULT_TYPE = "platform.gateway.field_options.result";

/**
 * Budget of both discovery subjects. They only read in-memory state, so this
 * is far below the callers' own timeouts (the api waits 10_000 for field
 * options) and only bounds a request that queued behind busy handlers.
 */
export const DISCOVERY_BUDGET_MS = 2_000;

export interface PlatformCapability {
  id: PlatformId;
  displayName: string;
  /** The platform adapter's lifecycle state. */
  state: AdapterState;
  connected: boolean;
  enabled: boolean;
  /** The actions the platform has an egress handler for, whatever its state. */
  actions: EgressActionId[];
}

export type CapabilitiesReply = { platforms: PlatformCapability[] } | { error: string };

export interface FieldOption {
  value: PlatformId;
  label: string;
}

/** The options of a select field, or the reason there are none: the shape every field-options reply takes. */
export type FieldOptionsReply = FieldOption[] | { error: string };

export type DiscoveryAdapters = Pick<AdapterStatusSource, "status" | "link">;

export interface GatewayDiscoveryDeps {
  egress: EgressRegistry;
  adapters: DiscoveryAdapters;
  requests: HostRequests;
}

/**
 * Serves platform.gateway.capabilities and platform.gateway.field_options:
 * which platforms exist, what each can do and whether it is usable now.
 * Callers use it to offer only platforms that can perform an action.
 */
export class GatewayDiscovery {
  constructor(private readonly deps: GatewayDiscoveryDeps) {}

  /** The subjects and budgets served, for the host scope's grants and its shutdown bound. */
  get served(): ReadonlyArray<{ subject: string; budgetMs: number }> {
    return [
      { subject: PLATFORM_GATEWAY_SUBJECTS.capabilities, budgetMs: DISCOVERY_BUDGET_MS },
      { subject: PLATFORM_GATEWAY_SUBJECTS.fieldOptions, budgetMs: DISCOVERY_BUDGET_MS },
    ];
  }

  async serve(scope: ScopedBus): Promise<void> {
    await this.deps.requests.serveRequest<undefined, CapabilitiesReply>(scope, {
      subject: PLATFORM_GATEWAY_SUBJECTS.capabilities,
      budgetMs: DISCOVERY_BUDGET_MS,
      replyMode: "cloudevent",
      replyType: GATEWAY_CAPABILITIES_RESULT_TYPE,
      // The request carries nothing; whatever a caller sends is ignored.
      parse: () => parsed(undefined),
      handle: async () => ({ platforms: this.capabilities() }),
      errorReply: (_code, message) => ({ error: message }),
    });
    await this.deps.requests.serveRequest<EgressActionId | UnknownAction, FieldOptionsReply>(scope, {
      subject: PLATFORM_GATEWAY_SUBJECTS.fieldOptions,
      budgetMs: DISCOVERY_BUDGET_MS,
      replyMode: "cloudevent",
      replyType: GATEWAY_FIELD_OPTIONS_RESULT_TYPE,
      parse: parseFieldOptionsRequest,
      handle: async (action) => this.fieldOptions(action),
      errorReply: (_code, message) => ({ error: message }),
    });
  }

  capabilities(): PlatformCapability[] {
    return this.deps.egress.platforms.map((platform) => {
      const adapter = platformAdapterId(platform);
      const link = this.deps.adapters.link(adapter);
      return {
        id: platform,
        displayName: PLATFORM_DISPLAY_NAMES[platform],
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
  private fieldOptions(action: EgressActionId | UnknownAction): FieldOptionsReply {
    if (typeof action !== "string") {
      return { error: `unknown action "${action.unknown}"` };
    }
    return this.capabilities()
      .filter((platform) => platform.connected && platform.enabled && platform.actions.includes(action))
      .map((platform) => ({ value: platform.id, label: platform.displayName }));
  }
}

/** An action name the catalog does not have, kept to say so in the reply. */
interface UnknownAction {
  unknown: string;
}

const decoder = new TextDecoder();

/**
 * The request is `{ action }`. The api relays a module field's request as a
 * CloudEvent envelope, so `{ data: { action } }` is read the same way.
 */
function parseFieldOptionsRequest(raw: Uint8Array): ParseResult<EgressActionId | UnknownAction> {
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(raw));
  } catch {
    return parseFailed("request is not JSON");
  }
  const body = unwrap(value);
  const action = body?.action;
  if (typeof action !== "string" || action === "") {
    return parseFailed("action is required");
  }
  return parsed(isEgressActionId(action) ? action : { unknown: action });
}

function unwrap(value: unknown): { action?: unknown } | null {
  if (!isRecord(value)) {
    return null;
  }
  if (!("action" in value) && isRecord(value.data)) {
    return value.data;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
