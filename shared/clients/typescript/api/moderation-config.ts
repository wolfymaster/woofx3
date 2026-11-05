/**
 * Chat moderation's configuration, as the engine stores it under the setting
 * `moderation.config` and the dashboard edits it. The engine is the
 * authority; the dashboard runs the same parser so a streamer sees a problem
 * before saving. Nothing here names a platform: each platform adapter checks
 * its own limits again when it acts.
 */

import { MODERATION_LIMITS, type ModerationParseResult } from "./moderation-limits";
import { asWholeWord, type Pattern, parsePattern } from "./moderation-pattern";

export { MODERATION_LIMITS, type ModerationParseResult };

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

function failed<T>(error: string): ModerationParseResult<T> {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `raw` as an object with exactly `keys`, each present. */
function readFields<K extends string>(raw: unknown, keys: readonly K[]): ModerationParseResult<Record<K, unknown>> {
  if (!isRecord(raw)) {
    return failed("must be an object");
  }
  const unknownKey = Object.keys(raw).find((key) => !(keys as readonly string[]).includes(key));
  if (unknownKey !== undefined) {
    return failed(`unknown field "${unknownKey}"`);
  }
  const missing = keys.find((key) => raw[key] === undefined);
  if (missing !== undefined) {
    return failed(`${missing} is required`);
  }
  return { ok: true, value: raw as Record<K, unknown> };
}

function readInteger(value: unknown, name: string, min: number, max: number): ModerationParseResult<number> {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    return failed(`${name} must be a whole number from ${min} to ${max}`);
  }
  return { ok: true, value };
}

/** One DNS label: letters or digits in any script, inner hyphens. */
const DOMAIN_LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u;

/**
 * `text` as a lower-case host name in its ASCII (punycode) form, or null when
 * it is not one: at least two labels, none empty. Shared by the allowlist
 * parser and the links filter so both compare the same form.
 */
export function normaliseHost(text: string): string | null {
  const host = text.trim().toLowerCase().replace(/\.$/, "");
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((label) => DOMAIN_LABEL.test(label))) {
    return null;
  }
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}

export interface LinksParams {
  /** Hosts in ASCII form; each allows itself and its subdomains. */
  allowDomains: string[];
  /** How long `!permit` lets a viewer post links. */
  permitSeconds: number;
}

export const DEFAULT_LINKS_PARAMS: LinksParams = { allowDomains: [], permitSeconds: 60 };

export function parseLinksParams(raw: unknown): ModerationParseResult<LinksParams> {
  const fields = readFields(raw, ["allowDomains", "permitSeconds"]);
  if (!fields.ok) {
    return fields;
  }
  const { allowDomains, permitSeconds } = fields.value;
  if (!Array.isArray(allowDomains) || allowDomains.length > MODERATION_LIMITS.maxAllowDomains) {
    return failed(`allowDomains must be a list of at most ${MODERATION_LIMITS.maxAllowDomains} websites`);
  }
  const domains: string[] = [];
  for (const [index, entry] of allowDomains.entries()) {
    if (typeof entry !== "string" || entry.length > MODERATION_LIMITS.maxDomainChars) {
      return failed(`allowDomains[${index}] must be a website name`);
    }
    const withoutScheme = entry.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./i, "");
    const host = normaliseHost(withoutScheme.split(/[/?#]/, 1)[0] ?? "");
    if (host === null) {
      return failed(`allowDomains[${index}]: "${entry}" is not a website name like example.com`);
    }
    if (!domains.includes(host)) {
      domains.push(host);
    }
  }
  const seconds = readInteger(permitSeconds, "permitSeconds", 0, MODERATION_LIMITS.maxPermitSeconds);
  if (!seconds.ok) {
    return seconds;
  }
  return { ok: true, value: { allowDomains: domains, permitSeconds: seconds.value } };
}

/** A share of a line's characters: caps among its letters, or symbols among its characters. */
export interface ShareParams {
  /** Lines shorter than this (in counted characters) never trip the rule, so "LOL" is fine. */
  minLength: number;
  /** Trips above this percentage. */
  maxPercent: number;
}

export const DEFAULT_CAPS_PARAMS: ShareParams = { minLength: 15, maxPercent: 70 };
export const DEFAULT_SYMBOLS_PARAMS: ShareParams = { minLength: 15, maxPercent: 50 };

export function parseShareParams(raw: unknown): ModerationParseResult<ShareParams> {
  const fields = readFields(raw, ["minLength", "maxPercent"]);
  if (!fields.ok) {
    return fields;
  }
  const minLength = readInteger(fields.value.minLength, "minLength", 1, MODERATION_LIMITS.maxMinLength);
  if (!minLength.ok) {
    return minLength;
  }
  const maxPercent = readInteger(fields.value.maxPercent, "maxPercent", 1, 99);
  if (!maxPercent.ok) {
    return maxPercent;
  }
  return { ok: true, value: { minLength: minLength.value, maxPercent: maxPercent.value } };
}

export interface RepetitionParams {
  windowSeconds: number;
  /** The same line this many times in the window is fine; once more trips the rule. */
  maxRepeats: number;
  /** Lines shorter than this, after folding case and spaces, are never counted. */
  minLength: number;
}

export const DEFAULT_REPETITION_PARAMS: RepetitionParams = { windowSeconds: 30, maxRepeats: 3, minLength: 5 };

export function parseRepetitionParams(raw: unknown): ModerationParseResult<RepetitionParams> {
  const fields = readFields(raw, ["windowSeconds", "maxRepeats", "minLength"]);
  if (!fields.ok) {
    return fields;
  }
  const windowSeconds = readInteger(
    fields.value.windowSeconds,
    "windowSeconds",
    1,
    MODERATION_LIMITS.maxRepetitionWindowSeconds
  );
  if (!windowSeconds.ok) {
    return windowSeconds;
  }
  const maxRepeats = readInteger(fields.value.maxRepeats, "maxRepeats", 1, MODERATION_LIMITS.maxRepeats);
  if (!maxRepeats.ok) {
    return maxRepeats;
  }
  const minLength = readInteger(fields.value.minLength, "minLength", 1, MODERATION_LIMITS.maxMinLength);
  if (!minLength.ok) {
    return minLength;
  }
  return {
    ok: true,
    value: { windowSeconds: windowSeconds.value, maxRepeats: maxRepeats.value, minLength: minLength.value },
  };
}

export interface BannedPhrase {
  /** In the grammar of ./moderation-pattern.ts. */
  pattern: string;
  /** Match only whole words; otherwise inside words too. */
  wholeWord: boolean;
}

export interface BannedPhrasesParams {
  phrases: BannedPhrase[];
}

export const DEFAULT_BANNED_PHRASES_PARAMS: BannedPhrasesParams = { phrases: [] };

/** Refuses a bad pattern by its position, never echoing the phrase list. */
export function parseBannedPhrasesParams(raw: unknown): ModerationParseResult<BannedPhrasesParams> {
  const fields = readFields(raw, ["phrases"]);
  if (!fields.ok) {
    return fields;
  }
  const { phrases } = fields.value;
  if (!Array.isArray(phrases) || phrases.length > MODERATION_LIMITS.maxPhrases) {
    return failed(`phrases must be a list of at most ${MODERATION_LIMITS.maxPhrases}`);
  }
  const parsed: BannedPhrase[] = [];
  let totalChars = 0;
  for (const [index, entry] of phrases.entries()) {
    const phrase = readFields(entry, ["pattern", "wholeWord"]);
    if (!phrase.ok) {
      return failed(`phrases[${index}]: ${phrase.error}`);
    }
    const { pattern, wholeWord } = phrase.value;
    if (typeof pattern !== "string" || typeof wholeWord !== "boolean") {
      return failed(`phrases[${index}] must be { pattern: text, wholeWord: true or false }`);
    }
    const compiled = parsePattern(pattern);
    if (!compiled.ok) {
      return failed(`phrases[${index}] ${compiled.error}`);
    }
    totalChars += [...pattern].length;
    parsed.push({ pattern, wholeWord });
  }
  if (totalChars > MODERATION_LIMITS.maxTotalPatternChars) {
    return failed(`phrases add up to more than ${MODERATION_LIMITS.maxTotalPatternChars} characters`);
  }
  return { ok: true, value: { phrases: parsed } };
}

/** Each phrase compiled. Only for params `parseBannedPhrasesParams` accepted, so a failure is a bug. */
export function compilePhrases(params: BannedPhrasesParams): Pattern[] {
  return params.phrases.map((phrase) => {
    const compiled = parsePattern(phrase.pattern);
    if (!compiled.ok) {
      throw new Error(`a banned phrase that passed its parser no longer compiles: ${compiled.error}`);
    }
    return phrase.wholeWord ? asWholeWord(compiled.value) : compiled.value;
  });
}

/** The engine setting the config is stored under, as JSON. */
export const MODERATION_CONFIG_SETTING_KEY = "moderation.config";

/** Bus subjects, which are also the CloudEvent types published on them. */
export const MODERATION_SUBJECTS = {
  /** Published after the stored config changes; the engine reloads it. */
  configUpdated: "moderation.config.updated",
  /** One per moderated line, with each step's outcome. */
  actionTaken: "moderation.action.taken",
} as const;

/** Each filter's params parser: the only list of them, so a new filter cannot be left out. */
export const FILTER_PARAM_PARSERS: { readonly [F in FilterId]: (raw: unknown) => ModerationParseResult<unknown> } = {
  banned_phrases: parseBannedPhrasesParams,
  links: parseLinksParams,
  repetition: parseRepetitionParams,
  caps: parseShareParams,
  symbols: parseShareParams,
};

/** Each filter's params when a streamer first turns it on. */
export const DEFAULT_FILTER_PARAMS: { readonly [F in FilterId]: unknown } = {
  banned_phrases: DEFAULT_BANNED_PHRASES_PARAMS,
  links: DEFAULT_LINKS_PARAMS,
  repetition: DEFAULT_REPETITION_PARAMS,
  caps: DEFAULT_CAPS_PARAMS,
  symbols: DEFAULT_SYMBOLS_PARAMS,
};

const LOGIN = /^[\p{L}\p{N}_.-]+$/u;

function readBoolean(value: unknown, name: string): ModerationParseResult<boolean> {
  return typeof value === "boolean" ? { ok: true, value } : failed(`${name} must be true or false`);
}

function readLogins(value: unknown, name: string): ModerationParseResult<string[]> {
  if (!Array.isArray(value) || value.length > MODERATION_LIMITS.maxAllowLogins) {
    return failed(`${name} must be a list of at most ${MODERATION_LIMITS.maxAllowLogins} names`);
  }
  const logins: string[] = [];
  for (const [index, entry] of value.entries()) {
    const login = typeof entry === "string" ? entry.trim().replace(/^@/, "").toLowerCase() : "";
    if (!LOGIN.test(login) || [...login].length > MODERATION_LIMITS.maxLoginChars) {
      return failed(`${name}[${index}] must be a chat name`);
    }
    if (!logins.includes(login)) {
      logins.push(login);
    }
  }
  return { ok: true, value: logins };
}

const ROLE_FLAGS = ["moderators", "vips", "subscribers"] as const;

function parseExemptions(raw: unknown): ModerationParseResult<Exemptions> {
  if (!isRecord(raw)) {
    return failed("exempt must be an object");
  }
  if (raw.broadcaster !== undefined && raw.broadcaster !== true) {
    return failed("exempt.broadcaster is always true: the broadcaster is never moderated");
  }
  const { broadcaster: _always, ...rest } = raw;
  const fields = readFields(rest, [...ROLE_FLAGS, "allowLogins"]);
  if (!fields.ok) {
    return failed(`exempt: ${fields.error}`);
  }
  const exempt: Exemptions = { ...DEFAULT_EXEMPTIONS, allowLogins: [] };
  for (const flag of ROLE_FLAGS) {
    const value = readBoolean(fields.value[flag], `exempt.${flag}`);
    if (!value.ok) {
      return value;
    }
    exempt[flag] = value.value;
  }
  const logins = readLogins(fields.value.allowLogins, "exempt.allowLogins");
  if (!logins.ok) {
    return logins;
  }
  exempt.allowLogins = logins.value;
  return { ok: true, value: exempt };
}

function parseRuleExemptions(raw: unknown, name: string): ModerationParseResult<RuleExemptions> {
  if (!isRecord(raw)) {
    return failed(`${name} must be an object`);
  }
  const exempt: RuleExemptions = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "allowLogins") {
      const logins = readLogins(value, `${name}.allowLogins`);
      if (!logins.ok) {
        return logins;
      }
      exempt.allowLogins = logins.value;
    } else if ((ROLE_FLAGS as readonly string[]).includes(key)) {
      const flag = readBoolean(value, `${name}.${key}`);
      if (!flag.ok) {
        return flag;
      }
      exempt[key as (typeof ROLE_FLAGS)[number]] = flag.value;
    } else {
      return failed(`${name}: unknown field "${key}"`);
    }
  }
  return { ok: true, value: exempt };
}

/** A warning reason is shown to the chatter as plain text; one starting with "/" could read as a chat command. */
export function warnReasonProblem(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed === "") {
    return "a warning needs a reason";
  }
  if ([...trimmed].length > MODERATION_LIMITS.maxWarnReasonChars) {
    return `a warning reason is at most ${MODERATION_LIMITS.maxWarnReasonChars} characters`;
  }
  if (trimmed.startsWith("/")) {
    return 'a warning reason must not start with "/"';
  }
  return null;
}

function parseAction(raw: unknown, name: string): ModerationParseResult<ModerationAction> {
  if (!isRecord(raw)) {
    return failed(`${name} must be an object`);
  }
  switch (raw.kind) {
    case "delete":
    case "ban": {
      const fields = readFields(raw, ["kind"]);
      return fields.ok ? { ok: true, value: { kind: raw.kind } } : failed(`${name}: ${fields.error}`);
    }
    case "warn": {
      const fields = readFields(raw, ["kind", "reason"]);
      if (!fields.ok) {
        return failed(`${name}: ${fields.error}`);
      }
      if (typeof raw.reason !== "string") {
        return failed(`${name}.reason must be text`);
      }
      const problem = warnReasonProblem(raw.reason);
      return problem === null
        ? { ok: true, value: { kind: "warn", reason: raw.reason.trim() } }
        : failed(`${name}: ${problem}`);
    }
    case "timeout": {
      const fields = readFields(raw, ["kind", "durationSeconds"]);
      if (!fields.ok) {
        return failed(`${name}: ${fields.error}`);
      }
      const duration = readInteger(
        raw.durationSeconds,
        `${name}.durationSeconds`,
        1,
        MODERATION_LIMITS.maxTimeoutSeconds
      );
      return duration.ok ? { ok: true, value: { kind: "timeout", durationSeconds: duration.value } } : duration;
    }
    default: {
      return failed(`${name}.kind must be one of ${MODERATION_ACTION_KINDS.join(", ")}`);
    }
  }
}

/** Non-empty, one of each kind, at most one of timeout and ban, kept in the order they run. */
function parseActions(raw: unknown, name: string): ModerationParseResult<ModerationAction[]> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return failed(`${name} must list at least one action`);
  }
  const actions: ModerationAction[] = [];
  for (const [index, entry] of raw.entries()) {
    const action = parseAction(entry, `${name}[${index}]`);
    if (!action.ok) {
      return action;
    }
    if (actions.some((taken) => taken.kind === action.value.kind)) {
      return failed(`${name} lists ${action.value.kind} twice`);
    }
    actions.push(action.value);
  }
  if (actions.some((a) => a.kind === "timeout") && actions.some((a) => a.kind === "ban")) {
    return failed(`${name} may time out or ban, not both`);
  }
  actions.sort((a, b) => MODERATION_ACTION_KINDS.indexOf(a.kind) - MODERATION_ACTION_KINDS.indexOf(b.kind));
  return { ok: true, value: actions };
}

function parseRule(filter: FilterId, raw: unknown): ModerationParseResult<ModerationRule> {
  const name = `rules.${filter}`;
  if (!isRecord(raw)) {
    return failed(`${name} must be an object`);
  }
  const { exempt: rawExempt, ...rest } = raw;
  const fields = readFields(rest, ["enabled", "actions", "params"]);
  if (!fields.ok) {
    return failed(`${name}: ${fields.error}`);
  }
  const enabled = readBoolean(fields.value.enabled, `${name}.enabled`);
  if (!enabled.ok) {
    return enabled;
  }
  const actions = parseActions(fields.value.actions, `${name}.actions`);
  if (!actions.ok) {
    return actions;
  }
  const params = FILTER_PARAM_PARSERS[filter](fields.value.params);
  if (!params.ok) {
    return failed(`${name}.params: ${params.error}`);
  }
  const rule: ModerationRule = { enabled: enabled.value, actions: actions.value, params: params.value };
  if (rawExempt !== undefined) {
    const exempt = parseRuleExemptions(rawExempt, `${name}.exempt`);
    if (!exempt.ok) {
      return exempt;
    }
    rule.exempt = exempt.value;
  }
  return { ok: true, value: rule };
}

/**
 * The config, checked field by field against MODERATION_LIMITS and each
 * filter's params parser, or the first problem in words a streamer can act
 * on. The engine runs it on save and on load; the dashboard runs it as the
 * streamer edits. An unknown version is refused, not guessed at.
 */
export function parseModerationConfig(raw: unknown): ModerationParseResult<ModerationConfig> {
  if (!isRecord(raw)) {
    return failed("the moderation config must be an object");
  }
  if (raw.version !== 1) {
    return failed(`version ${JSON.stringify(raw.version)} is not one this engine reads; expected 1`);
  }
  const fields = readFields(raw, ["version", "enabled", "dryRun", "exempt", "rules"]);
  if (!fields.ok) {
    return fields;
  }
  const enabled = readBoolean(fields.value.enabled, "enabled");
  if (!enabled.ok) {
    return enabled;
  }
  const dryRun = readBoolean(fields.value.dryRun, "dryRun");
  if (!dryRun.ok) {
    return dryRun;
  }
  const exempt = parseExemptions(fields.value.exempt);
  if (!exempt.ok) {
    return exempt;
  }
  if (!isRecord(fields.value.rules)) {
    return failed("rules must be an object");
  }
  const rules: Partial<Record<FilterId, ModerationRule>> = {};
  for (const [key, value] of Object.entries(fields.value.rules)) {
    if (!isFilterId(key)) {
      return failed(`rules: "${key}" is not a filter; expected one of ${FILTER_IDS.join(", ")}`);
    }
    const rule = parseRule(key, value);
    if (!rule.ok) {
      return rule;
    }
    rules[key] = rule.value;
  }
  return {
    ok: true,
    value: { version: 1, enabled: enabled.value, dryRun: dryRun.value, exempt: exempt.value, rules },
  };
}

/**
 * How one step of a rule ended:
 * - done: the platform did it; unconfirmed: it may have, its answer never came;
 * - skipped: not attempted. cooldown: the chatter was warned moments ago; dry_run: test mode;
 *   protected: a timeout or ban aimed at the broadcaster, a moderator, a VIP or an unknown role;
 *   busy: a warn dropped because the platform was already refusing writes as rate limited;
 * - failed: attempted and refused, by the platform's failure code, or unsupported or
 *   unavailable on that platform.
 */
export const MODERATION_STEP_OUTCOMES = [
  "done",
  "unconfirmed",
  "skipped:cooldown",
  "skipped:dry_run",
  "skipped:protected",
  "skipped:busy",
  "failed:invalid",
  "failed:rate_limited",
  "failed:forbidden",
  "failed:upstream",
  "failed:unsupported",
  "failed:unavailable",
] as const;
export type ModerationStepOutcome = (typeof MODERATION_STEP_OUTCOMES)[number];

/** The data of a `moderation.action.taken` event: one moderated line. */
export interface ModerationActionTaken {
  platform: string;
  /** The platform's user id of the chatter. */
  viewer: string;
  chatterLogin: string;
  messageId: string;
  filter: FilterId;
  reason: string;
  score?: number;
  /** The line's first characters only. */
  text: string;
  dryRun: boolean;
  steps: Array<{ kind: ModerationActionKind; outcome: ModerationStepOutcome }>;
}
