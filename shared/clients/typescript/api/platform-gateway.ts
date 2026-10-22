/**
 * The platform gateway's wire contract for TypeScript: the generated catalog,
 * shapes and parsers (platform-gateway.gen.ts, from
 * shared/common/contracts/platform-gateway.json) plus the outcome policy that
 * turns per-platform results into a reply's `ok`. See
 * docs/services/platform-gateway.md.
 */
import type { PlatformOutcome, PlatformResults, Target } from "./platform-gateway.gen";

export * from "./platform-gateway.gen";

/**
 * Whether an outcome counts towards a reply's `ok`. Only `delivered` does:
 * `unconfirmed` may have posted, but a caller that treated it as success
 * would report a line nobody can confirm.
 */
export function outcomeCountsAsDelivered(outcome: PlatformOutcome | undefined): boolean {
  return outcome?.status === "delivered";
}

/**
 * The reply's `ok` for a target and its results. A request naming platforms
 * (directly, or through its origin) succeeds only if every one of them
 * delivered; a request for all platforms succeeds if at least one did, so a
 * platform that cannot do the action does not fail the rest. A target that
 * resolved to no platform is not ok.
 */
export function replyOk(target: Target, results: PlatformResults): boolean {
  switch (target.kind) {
    case "platforms": {
      return target.ids.length > 0 && target.ids.every((id) => outcomeCountsAsDelivered(results[id]));
    }
    case "origin": {
      return outcomeCountsAsDelivered(results[target.origin.platform]);
    }
    case "all": {
      return Object.values(results).some((outcome) => outcomeCountsAsDelivered(outcome));
    }
  }
}
