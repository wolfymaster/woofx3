/**
 * The engine's own moderation tunables. The limits a config must stay within
 * are MODERATION_LIMITS in @woofx3/api/moderation-config, shared with the
 * dashboard; these only shape how the engine runs a valid config.
 */
export const MODERATION_TUNABLES = {
  /** A chatter is warned at most once in this long, so a spammer is not warned for every line. */
  warnCooldownSeconds: 30,
  /** A rule taking longer than this on one line is logged. */
  slowRuleWarnMs: 5,
  /** Chatters whose recent lines are remembered for the repetition filter. */
  historyChatters: 5_000,
  /** Lines remembered per chatter. */
  historyLinesPerChatter: 20,
  /** Permits held at once. */
  permitCapacity: 1_000,
  /** Chatters whose warn cooldown is tracked. */
  warnCooldownChatters: 5_000,
  /** Characters of a moderated line kept in its action event. */
  recordedTextChars: 100,
} as const;
