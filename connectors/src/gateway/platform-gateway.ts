import {
  type EgressActionId,
  type FailureCode,
  type GatewayReply,
  type GatewayRequest,
  type GatewayRequestOf,
  type OutcomeStatus,
  PLATFORM_GATEWAY_REPLY_TYPES,
  PLATFORM_GATEWAY_SUBJECTS,
  type PlatformId,
  type PlatformOutcome,
  type PlatformResults,
  parseGatewayRequest,
  parsePlatformOutcome,
  replyOk,
} from "@woofx3/api/platform-gateway";
import type { GatewayConfig } from "../config/gateway";
import { platformAdapterId } from "../host/adapter";
import type { Clock, Logger } from "../host/deps";
import { boundedBySignal } from "../host/bounded";
import { errorMessage } from "../host/deps";
import {
  type HostRequestErrorCode,
  type HostRequests,
  type ParseResult,
  parsed,
  parseFailed,
  type RequestContext,
} from "../host/host-requests";
import type { ScopedBus } from "../host/scoped-bus";
import { type AdapterStatusSource, whenSettled } from "../host/served-subjects";
import { GatewayDiscovery, type GatewayDiscoveryDeps } from "./discovery";
import type { EgressRegistry } from "./egress-registry";
import { fingerprint, IdempotencyCache } from "./idempotency";
import { resolveTarget, type TargetResolution, type TargetView, withOriginReply } from "./targets";

/**
 * The failure code a whole-request refusal carries for each reason the host
 * answered instead of the gateway. `expired` means the request queued behind
 * busy handlers past its budget and nothing was attempted, so the caller may
 * try again later.
 */
const REFUSAL_CODES: Readonly<Record<HostRequestErrorCode, FailureCode>> = {
  invalid: "invalid",
  internal: "upstream",
  expired: "rate_limited",
};

export type GatewayAdapters = Pick<AdapterStatusSource, "status" | "link" | "onStatusChange">;

export interface PlatformGatewayDeps {
  config: GatewayConfig;
  egress: EgressRegistry;
  adapters: GatewayAdapters;
  requests: HostRequests;
  clock: Clock;
  logger: Logger;
  /** Display names for discovery; defaults to the contract table. */
  displayNames?: GatewayDiscoveryDeps["displayNames"];
}

export type OutcomeCounts = Partial<
  Record<PlatformId, Partial<Record<EgressActionId, Partial<Record<OutcomeStatus, number>>>>>
>;

export interface GatewayCounters {
  /** Outcomes of requests the gateway performed, per platform, action and status. Replays are not counted again. */
  outcomes: OutcomeCounts;
  idempotency: { replayed: number; coalesced: number; mismatched: number; held: number };
}

/**
 * Whether a reply is worth replaying for its key. A reply in which nothing
 * reached a platform (all unavailable, unsupported or failed) is not kept, so
 * a caller retrying with the same key after a transient outage gets a real
 * attempt instead of the stale refusal.
 */
function reachedAPlatform(reply: GatewayReply): boolean {
  return Object.values(reply.results).some(
    (outcome) => outcome.status === "delivered" || outcome.status === "dropped" || outcome.status === "unconfirmed"
  );
}

/**
 * Serves platform.gateway.send: validates the request, resolves its target
 * to platforms, and fans the action out to each platform's egress handler
 * at once, so a slow platform never delays another. Every platform the
 * target resolved to gets an outcome, and the reply's `ok` follows
 * `replyOk`. Nothing is retried: a repeated idempotency key replays the
 * first reply instead.
 */
export class PlatformGateway {
  private readonly idempotency: IdempotencyCache<GatewayReply>;
  private readonly outcomes: OutcomeCounts = {};
  private readonly idempotencyCounts = { replayed: 0, coalesced: 0, mismatched: 0 };
  private readonly view: TargetView;
  private readonly discovery: GatewayDiscovery;

  constructor(private readonly deps: PlatformGatewayDeps) {
    this.discovery = new GatewayDiscovery({
      egress: deps.egress,
      adapters: deps.adapters,
      requests: deps.requests,
      budgetMs: deps.config.discoveryBudgetMs,
      displayNames: deps.displayNames,
    });
    this.idempotency = new IdempotencyCache(deps.config.idempotency, deps.clock);
    this.view = {
      platforms: deps.egress.platforms,
      supports: (platform, action) => deps.egress.supports(platform, action),
      link: (platform) => deps.adapters.link(platformAdapterId(platform)),
    };
  }

  /** The subjects and budgets the gateway serves, for the host scope's grants and its shutdown bound. */
  get served(): ReadonlyArray<{ subject: string; budgetMs: number }> {
    return [
      { subject: PLATFORM_GATEWAY_SUBJECTS.send, budgetMs: this.deps.config.adapterDeadlineMs },
      ...this.discovery.served,
    ];
  }

  async serve(scope: ScopedBus): Promise<void> {
    await this.deps.requests.serveRequest<GatewayRequest, GatewayReply>(scope, {
      subject: PLATFORM_GATEWAY_SUBJECTS.send,
      budgetMs: this.deps.config.adapterDeadlineMs,
      replyMode: "cloudevent",
      replyType: PLATFORM_GATEWAY_REPLY_TYPES.send,
      parse: parseRequest,
      handle: (request, ctx) => this.send(request, ctx),
      errorReply: (code, message) => refusal(REFUSAL_CODES[code], message),
    });
    await this.discovery.serve(scope);
  }

  snapshot(): GatewayCounters {
    return {
      outcomes: structuredClone(this.outcomes),
      idempotency: { ...this.idempotencyCounts, held: this.idempotency.size },
    };
  }

  private async send(request: GatewayRequest, ctx: RequestContext): Promise<GatewayReply> {
    const resolution = resolveTarget(request.target, request.action, this.view);
    if (!resolution.ok) {
      this.log("refused", request, { problem: resolution.problem });
      return refusal("invalid", resolution.problem);
    }

    const key = `${request.requestedBy.kind}:${request.idempotencyKey}`;
    const run = await this.idempotency.run(
      key,
      fingerprint(request),
      () => this.fanOut(request, resolution, ctx),
      reachedAPlatform
    );
    switch (run.kind) {
      case "fresh":
        this.log("sent", request, { ok: run.value.ok, results: statuses(run.value.results) });
        return run.value;
      case "replayed":
      case "coalesced":
        this.idempotencyCounts[run.kind]++;
        this.log(run.kind, request, { ok: run.value.ok, results: statuses(run.value.results) });
        return run.value;
      case "mismatch": {
        this.idempotencyCounts.mismatched++;
        const problem = "idempotencyKey was already used for a different request";
        this.log("refused", request, { problem });
        return refusal("invalid", problem);
      }
    }
  }

  private async fanOut(
    request: GatewayRequest,
    resolution: Extract<TargetResolution, { ok: true }>,
    ctx: RequestContext
  ): Promise<GatewayReply> {
    const sending = withOriginReply(request);
    const results: PlatformResults = {};
    for (const platform of resolution.unsupported) {
      results[platform] = { status: "unsupported" };
    }
    const settled = await Promise.allSettled(
      resolution.deliver.map((platform) => this.deliverTo(platform, sending, ctx))
    );
    for (const [index, platform] of resolution.deliver.entries()) {
      const outcome = settled[index];
      results[platform] =
        outcome?.status === "fulfilled"
          ? outcome.value
          : { status: "failed", code: "upstream", message: errorMessage(outcome?.reason) };
    }
    for (const [platform, outcome] of Object.entries(results) as Array<[PlatformId, PlatformOutcome]>) {
      this.count(platform, request.action, outcome.status);
    }
    return { ok: replyOk(request.target, results), results };
  }

  /** One platform's outcome, settled by the request's deadline. */
  private async deliverTo<A extends EgressActionId>(
    platform: PlatformId,
    request: GatewayRequestOf<A>,
    ctx: RequestContext
  ): Promise<PlatformOutcome> {
    const handler = this.deps.egress.handler(platform, request.action);
    if (handler === undefined) {
      return { status: "unsupported" };
    }

    const rawOptions = request.options?.[platform];
    let options: unknown;
    if (rawOptions !== undefined) {
      if (handler.parseOptions === undefined) {
        return invalid(`options.${platform}: ${platform} takes no options for ${request.action}`);
      }
      let parsedOptions: ParseResult<unknown>;
      try {
        parsedOptions = handler.parseOptions(rawOptions);
      } catch (error) {
        this.deps.logger.error("platform gateway options parser threw", {
          platform,
          action: request.action,
          error: errorMessage(error),
        });
        return { status: "failed", code: "upstream", message: errorMessage(error) };
      }
      if (!parsedOptions.ok) {
        return invalid(`options.${platform}: ${parsedOptions.error}`);
      }
      options = parsedOptions.value;
    }

    const adapter = platformAdapterId(platform);
    const link = this.deps.adapters.link(adapter);
    if (link !== null && !link.connected) {
      return { status: "unavailable", reason: "not_linked" };
    }
    if (link !== null && !link.enabled) {
      return { status: "unavailable", reason: "disabled" };
    }

    const settled = await whenSettled(this.deps.adapters, adapter, ctx.signal);
    if (settled.kind === "unavailable") {
      return { status: "unavailable", reason: settled.reason };
    }

    let sent = false;
    const call = (async () =>
      handler.handle(request.payload, options, {
        signal: ctx.signal,
        deadline: ctx.deadline,
        requestedBy: request.requestedBy,
        workflowChain: request.workflowChain,
        markSent: () => {
          sent = true;
        },
      }))();
    const run = await boundedBySignal(() => call, ctx.signal);
    if (run.kind === "timeout" || (run.kind === "failed" && ctx.signal.aborted)) {
      if (run.kind === "timeout") {
        this.logLateAnswer(platform, request.action, call);
      }
      if (sent) {
        return {
          status: "unconfirmed",
          message: `${platform} did not answer before the deadline; it may have acted`,
        };
      }
      return { status: "failed", code: "upstream", message: "did not reach the platform before the deadline" };
    }
    if (run.kind === "failed") {
      this.deps.logger.warn("platform gateway egress handler failed", {
        platform,
        action: request.action,
        error: errorMessage(run.error),
      });
      return { status: "failed", code: "upstream", message: errorMessage(run.error) };
    }
    const outcome = parsePlatformOutcome(run.value, `results.${platform}`);
    if (!outcome.ok) {
      this.deps.logger.error("platform gateway egress handler returned an invalid outcome", {
        platform,
        action: request.action,
        field: outcome.error.field,
        problem: outcome.error.problem,
      });
      return { status: "failed", code: "upstream", message: `${platform} returned an invalid outcome` };
    }
    return outcome.value;
  }

  private logLateAnswer(platform: PlatformId, action: EgressActionId, call: Promise<PlatformOutcome>): void {
    call.then(
      (outcome) => {
        this.deps.logger.warn("platform gateway egress handler answered after the deadline", {
          platform,
          action,
          status: outcome.status,
        });
      },
      (error: unknown) => {
        this.deps.logger.warn("platform gateway egress handler failed after the deadline", {
          platform,
          action,
          error: errorMessage(error),
        });
      }
    );
  }

  private count(platform: PlatformId, action: EgressActionId, status: OutcomeStatus): void {
    const byAction = this.outcomes[platform] ?? {};
    const byStatus = byAction[action] ?? {};
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    byAction[action] = byStatus;
    this.outcomes[platform] = byAction;
  }

  private log(event: string, request: GatewayRequest, detail: Record<string, unknown>): void {
    this.deps.logger.info(`platform gateway ${event}`, {
      action: request.action,
      target: request.target.kind,
      idempotencyKey: request.idempotencyKey,
      requestedBy: `${request.requestedBy.kind}:${request.requestedBy.ref}`,
      ...detail,
    });
  }
}

const decoder = new TextDecoder();

/** The request is the bare GatewayRequest JSON; only the reply is a CloudEvent. */
function parseRequest(raw: Uint8Array): ParseResult<GatewayRequest> {
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(raw));
  } catch {
    return parseFailed("request is not JSON");
  }
  const request = parseGatewayRequest(value);
  if (!request.ok) {
    return parseFailed(`${request.error.field}: ${request.error.problem}`);
  }
  return parsed(request.value);
}

function refusal(code: FailureCode, message: string): GatewayReply {
  return { ok: false, results: {}, error: { code, message } };
}

function invalid(message: string): PlatformOutcome {
  return { status: "failed", code: "invalid", message };
}

function statuses(results: PlatformResults): Record<string, OutcomeStatus> {
  const out: Record<string, OutcomeStatus> = {};
  for (const [platform, outcome] of Object.entries(results)) {
    if (outcome !== undefined) {
      out[platform] = outcome.status;
    }
  }
  return out;
}
