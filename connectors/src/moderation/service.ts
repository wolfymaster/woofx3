import {
  MODERATION_SUBJECTS,
  type ModerationAction,
  type ModerationActionTaken,
  type ModerationConfig,
  type ModerationStepOutcome,
} from "@woofx3/api/moderation-config";
import {
  EgressActionId,
  type GatewayRequest,
  PLATFORM_GATEWAY_SUBJECTS,
  type PlatformOutcome,
} from "@woofx3/api/platform-gateway";
import Event from "@woofx3/common/cloudevents/BaseEvent";
import { BoundedMap } from "../chat/bounded-map";
import { readGatewayReply } from "../chat/replier";
import type { ChatLine } from "../chat/trust";
import { viewerKeyString } from "../chat/viewer";
import { type Clock, errorMessage, type Logger } from "../host/deps";
import type { ScopedBus, SubjectGrants } from "../host/scoped-bus";
import type { MODERATION_TUNABLES } from "./defaults";
import { type EvaluatorDeps, evaluateLine, type RuleHit } from "./evaluator";
import { isProtectedFromPunishment } from "./exemptions";
import type { FilterRegistry } from "./registry";
import type { FilterEnv, ModerationLine } from "./types";

/** The CloudEvent `source` of moderation's events. */
export const MODERATION_EVENT_SOURCE = "connectors.moderation";

/** The `requestedBy.ref` of every moderation request to the platform gateway. */
export const MODERATION_REQUESTER_REF = "moderation";

/** Every subject moderation uses, for the grants of the scope it runs in. */
export const MODERATION_GRANTS: SubjectGrants = {
  subscribes: [MODERATION_SUBJECTS.configUpdated],
  publishes: [MODERATION_SUBJECTS.actionTaken],
  requests: [PLATFORM_GATEWAY_SUBJECTS.send],
};

/**
 * How one line ended, for tests and logs: skipped before any rule ran,
 * passed every rule, or moderated (dry run included).
 */
export type ModerationLineOutcome = "off" | "not_moderatable" | "passed" | "moderated";

export interface ModerationServiceDeps {
  config: { current(): ModerationConfig };
  registry: FilterRegistry;
  env: FilterEnv;
  bus: Pick<ScopedBus, "publish" | "request">;
  clock: Clock;
  logger: Logger;
  tunables: typeof MODERATION_TUNABLES;
  /** How long a step waits for the platform gateway. */
  gatewayTimeoutMs: number;
}

type Step = ModerationActionTaken["steps"][number];

/**
 * Moderates chat as a watcher on the chat dispatcher. Each line is checked
 * against a snapshot of the config taken when it arrives; on a hit, the
 * rule's actions run in order through the platform gateway to the line's
 * own platform, each on its own, so a failed warn never undoes the delete.
 * The outcome is published as `moderation.action.taken`. Nothing here knows
 * any platform: each one's egress says what it supports.
 */
export class ModerationService {
  private readonly warnedAt: BoundedMap<string, true>;
  /** Action kinds whose platform refused them as forbidden, logged once until one succeeds again. */
  private readonly forbidden = new Set<ModerationAction["kind"]>();
  private readonly evaluator: EvaluatorDeps;

  constructor(private readonly deps: ModerationServiceDeps) {
    this.warnedAt = new BoundedMap(
      { capacity: deps.tunables.warnCooldownChatters, ttlMs: deps.tunables.warnCooldownSeconds * 1_000 },
      deps.clock
    );
    this.evaluator = {
      registry: deps.registry,
      env: deps.env,
      clock: deps.clock,
      logger: deps.logger,
      slowRuleWarnMs: deps.tunables.slowRuleWarnMs,
    };
  }

  async handle(line: ChatLine): Promise<ModerationLineOutcome> {
    const config = this.deps.config.current();
    if (!config.enabled) {
      return "off";
    }
    // An untrusted line's speaker and badges are its publisher's say-so, a
    // partner channel's chatter is not this channel's to moderate, and a
    // line without the platform's id cannot be deleted.
    if (!line.trusted || line.sharedChat || line.messageId === undefined) {
      return "not_moderatable";
    }
    const moderated: ModerationLine = {
      platform: line.platform,
      viewer: line.viewer,
      chatterLogin: line.chatterLogin,
      text: line.text,
      messageId: line.messageId,
      membership: line.membership,
      paid: line.paid,
    };
    const hit = await evaluateLine(moderated, config, this.evaluator);
    if (hit === null) {
      return "passed";
    }
    const steps = await this.act(moderated, hit, config.dryRun);
    this.record(moderated, hit, config.dryRun, steps);
    return "moderated";
  }

  private async act(line: ModerationLine, hit: RuleHit, dryRun: boolean): Promise<Step[]> {
    const steps: Step[] = [];
    for (const action of hit.rule.actions) {
      steps.push({ kind: action.kind, outcome: await this.step(line, hit, action, dryRun, steps) });
    }
    return steps;
  }

  private async step(
    line: ModerationLine,
    hit: RuleHit,
    action: ModerationAction,
    dryRun: boolean,
    earlier: readonly Step[]
  ): Promise<ModerationStepOutcome> {
    if (dryRun) {
      return "skipped:dry_run";
    }
    if ((action.kind === "timeout" || action.kind === "ban") && isProtectedFromPunishment(line.membership)) {
      return "skipped:protected";
    }
    if (action.kind === "warn") {
      if (earlier.some((step) => step.outcome === "failed:rate_limited")) {
        return "skipped:busy";
      }
      const key = viewerKeyString(line.viewer);
      if (this.warnedAt.get(key) !== undefined) {
        return "skipped:cooldown";
      }
      this.warnedAt.set(key, true);
    }
    const outcome = await this.send(gatewayRequest(line, hit, action), line);
    this.noteForbidden(action.kind, outcome);
    return outcome;
  }

  private async send(request: GatewayRequest, line: ModerationLine): Promise<ModerationStepOutcome> {
    let raw: { data: Uint8Array };
    try {
      raw = await this.deps.bus.request(PLATFORM_GATEWAY_SUBJECTS.send, encoder.encode(JSON.stringify(request)), {
        timeout: this.deps.gatewayTimeoutMs,
      });
    } catch (error) {
      this.deps.logger.warn("a moderation step got no answer from the platform gateway", {
        action: request.action,
        error: errorMessage(error),
      });
      return "failed:upstream";
    }
    const reply = readGatewayReply(raw.data);
    if (!reply.ok) {
      this.deps.logger.error("the platform gateway answered a moderation step with something unreadable", {
        action: request.action,
        problem: reply.problem,
      });
      return "failed:upstream";
    }
    if (reply.value.error !== undefined) {
      this.deps.logger.warn("the platform gateway refused a moderation step", {
        action: request.action,
        error: reply.value.error,
      });
      return `failed:${reply.value.error.code}`;
    }
    return stepOutcome(reply.value.results[line.platform]);
  }

  /** A missing scope is logged once per outage, not once per line. */
  private noteForbidden(kind: ModerationAction["kind"], outcome: ModerationStepOutcome): void {
    if (outcome === "done") {
      this.forbidden.delete(kind);
      return;
    }
    if (outcome === "failed:forbidden" && !this.forbidden.has(kind)) {
      this.forbidden.add(kind);
      this.deps.logger.warn("the platform refused a moderation step as forbidden; reconnecting it may grant access", {
        action: kind,
      });
    }
  }

  private record(line: ModerationLine, hit: RuleHit, dryRun: boolean, steps: Step[]): void {
    const data: ModerationActionTaken = {
      platform: line.platform,
      viewer: line.viewer.platformUserId,
      chatterLogin: line.chatterLogin,
      messageId: line.messageId,
      filter: hit.filter,
      reason: hit.reason,
      ...(hit.score === undefined ? {} : { score: hit.score }),
      text: [...line.text].slice(0, this.deps.tunables.recordedTextChars).join(""),
      dryRun,
      steps,
    };
    const event = Event(
      { type: MODERATION_SUBJECTS.actionTaken, source: MODERATION_EVENT_SOURCE, platform: line.platform },
      data
    );
    this.deps.bus
      .publish(MODERATION_SUBJECTS.actionTaken, encoder.encode(JSON.stringify(event)))
      .catch((error: unknown) => {
        this.deps.logger.error("could not record a moderation action", {
          filter: hit.filter,
          error: errorMessage(error),
        });
      });
  }
}

const encoder = new TextEncoder();

/**
 * The gateway request for one step, to the line's own platform. The key is
 * the line's id and the step, so a line delivered twice is acted on once.
 */
export function gatewayRequest(line: ModerationLine, hit: RuleHit, action: ModerationAction): GatewayRequest {
  const common = {
    target: { kind: "origin", origin: { platform: line.platform, messageId: line.messageId } },
    idempotencyKey: `moderation:${line.messageId}:${action.kind}`,
    requestedBy: { kind: "dispatcher", ref: MODERATION_REQUESTER_REF },
  } as const;
  const viewer = line.viewer.platformUserId;
  switch (action.kind) {
    case "delete": {
      return { ...common, action: EgressActionId.CHAT_DELETE, payload: { messageId: line.messageId } };
    }
    case "warn": {
      return { ...common, action: EgressActionId.MODERATION_WARN, payload: { viewer, reason: action.reason } };
    }
    case "timeout": {
      return {
        ...common,
        action: EgressActionId.MODERATION_TIMEOUT,
        payload: { viewer, durationSeconds: action.durationSeconds, reason: hit.reason },
      };
    }
    case "ban": {
      return { ...common, action: EgressActionId.MODERATION_BAN, payload: { viewer, reason: hit.reason } };
    }
  }
}

function stepOutcome(outcome: PlatformOutcome | undefined): ModerationStepOutcome {
  switch (outcome?.status) {
    case "delivered": {
      return "done";
    }
    case "unconfirmed": {
      return "unconfirmed";
    }
    case "unsupported": {
      return "failed:unsupported";
    }
    case "unavailable": {
      return "failed:unavailable";
    }
    case "failed": {
      return `failed:${outcome.code}`;
    }
    case "dropped":
    case undefined: {
      return "failed:upstream";
    }
  }
}
