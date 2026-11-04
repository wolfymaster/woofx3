/**
 * Chat moderation's configuration, as the engine stores it under the setting
 * `moderation.config` and the dashboard edits it. The engine is the
 * authority; the dashboard runs the same parser so a streamer sees a problem
 * before saving. Nothing here names a platform: each platform adapter checks
 * its own limits again when it acts.
 */

/** A chat filter, in the order the engine evaluates them: cheap and most severe first. */
export const FILTER_IDS = ["banned_phrases", "links", "repetition", "caps", "symbols"] as const;
export type FilterId = (typeof FILTER_IDS)[number];

export function isFilterId(value: unknown): value is FilterId {
  return typeof value === "string" && (FILTER_IDS as readonly string[]).includes(value);
}

/** One step a rule takes on a hit. Steps run in this order: delete, warn, then timeout or ban. */
export const MODERATION_ACTION_KINDS = ["delete", "warn", "timeout", "ban"] as const;
export type ModerationActionKind = (typeof MODERATION_ACTION_KINDS)[number];

export type ModerationAction =
  | { kind: "delete" }
  /** The platform's own formal warning; `reason` is shown to the chatter. */
  | { kind: "warn"; reason: string }
  | { kind: "timeout"; durationSeconds: number }
  | { kind: "ban" };

/** Who no rule acts on. The broadcaster always is, so it is not a setting. */
export interface Exemptions {
  broadcaster: true;
  moderators: boolean;
  vips: boolean;
  subscribers: boolean;
  /** Lower-case logins. */
  allowLogins: string[];
}

/** A rule's own exemptions, each replacing the config-wide one it names. */
export type RuleExemptions = Partial<Omit<Exemptions, "broadcaster">>;

export interface ModerationRule<P = unknown> {
  enabled: boolean;
  /** Non-empty, one of each kind at most, and at most one of timeout and ban. */
  actions: ModerationAction[];
  exempt?: RuleExemptions;
  /** The filter's own parameters, checked by its parser. */
  params: P;
}

export interface ModerationConfig {
  version: 1;
  /** The master switch. */
  enabled: boolean;
  /** Evaluate and record every hit, but act on none. */
  dryRun: boolean;
  exempt: Exemptions;
  rules: Partial<Record<FilterId, ModerationRule>>;
}

/**
 * Ceilings enforced on save and on load. They sit at or below every
 * supported platform's own limits, so a valid config never asks a platform
 * for more than it takes; each platform adapter still checks its own.
 */
export const MODERATION_LIMITS = {
  /** Two weeks. */
  maxTimeoutSeconds: 1_209_600,
  maxWarnReasonChars: 200,
  maxAllowLogins: 200,
  maxLoginChars: 50,
  maxAllowDomains: 200,
  maxDomainChars: 253,
  /** One hour: a permit is meant for the next link, not the rest of the stream. */
  maxPermitSeconds: 3_600,
  maxPhrases: 200,
  maxPatternChars: 100,
  maxTotalPatternChars: 4_000,
  maxClassItems: 20,
  /** A pattern needs this many literal or class items, so it never matches nearly everything. */
  minPatternLiterals: 2,
  /** A line is scanned in its first this-many characters, above any platform's message length. */
  maxScanChars: 1_000,
  /** Bounds the repetition window, and so how long a chatter's lines are remembered. */
  maxRepetitionWindowSeconds: 600,
  maxRepeats: 20,
  /** A length threshold above this could never trip on a chat line. */
  maxMinLength: 500,
} as const;

/** Moderators, VIPs and subscribers are exempt until the streamer says otherwise. */
export const DEFAULT_EXEMPTIONS: Exemptions = {
  broadcaster: true,
  moderators: true,
  vips: true,
  subscribers: true,
  allowLogins: [],
};

/** Every rule acts only by deleting the line until the streamer chooses more. */
export const DEFAULT_ACTIONS: readonly ModerationAction[] = [{ kind: "delete" }];

/** What an engine with no stored config runs: nothing. */
export const DEFAULT_MODERATION_CONFIG: ModerationConfig = {
  version: 1,
  enabled: false,
  dryRun: false,
  exempt: DEFAULT_EXEMPTIONS,
  rules: {},
};

export type ModerationParseResult<T> = { ok: true; value: T } | { ok: false; error: string };
