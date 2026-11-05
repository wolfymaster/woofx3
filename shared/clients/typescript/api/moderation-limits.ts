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

export type ModerationParseResult<T> = { ok: true; value: T } | { ok: false; error: string };
