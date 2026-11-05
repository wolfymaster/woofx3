import { FILTER_IDS, type FilterId, type ModerationConfig, type ModerationRule } from "@woofx3/api/moderation-config";
import { type Clock, errorMessage, type Logger } from "../host/deps";
import { isExempt } from "./exemptions";
import type { FilterRegistry } from "./registry";
import type { FilterEnv, ModerationLine } from "./types";

/** The rule that caught a line, and why. */
export interface RuleHit {
  filter: FilterId;
  rule: ModerationRule;
  reason: string;
  score?: number;
}

export interface EvaluatorDeps {
  registry: FilterRegistry;
  env: FilterEnv;
  clock: Clock;
  logger: Logger;
  slowRuleWarnMs: number;
}

/**
 * The first enabled rule that catches `line`, in FILTER_IDS order, or null.
 * Later rules are not evaluated, so a line gets one rule's actions at most.
 * Each filter is awaited in turn, so an async one placed last never delays
 * the cheap ones. A filter that throws is logged and skipped.
 */
export async function evaluateLine(
  line: ModerationLine,
  config: ModerationConfig,
  deps: EvaluatorDeps
): Promise<RuleHit | null> {
  for (const filter of FILTER_IDS) {
    const rule = config.rules[filter];
    if (rule === undefined || !rule.enabled) {
      continue;
    }
    if (isExempt(line.membership, line.chatterLogin, config.exempt, rule.exempt)) {
      continue;
    }
    const startedAt = deps.clock.now();
    let verdict: Awaited<ReturnType<FilterRegistry[FilterId]["evaluate"]>>;
    try {
      verdict = await deps.registry[filter].evaluate(line, rule.params, deps.env);
    } catch (error) {
      deps.logger.error("a moderation filter failed; skipped for this line", { filter, error: errorMessage(error) });
      continue;
    }
    const elapsedMs = deps.clock.now() - startedAt;
    if (elapsedMs > deps.slowRuleWarnMs) {
      deps.logger.warn("a moderation filter was slow", { filter, elapsedMs });
    }
    if (verdict.hit) {
      return { filter, rule, reason: verdict.reason, ...(verdict.score === undefined ? {} : { score: verdict.score }) };
    }
  }
  return null;
}
