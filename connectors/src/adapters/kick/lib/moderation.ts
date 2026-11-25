/** Kick counts a timeout in whole minutes, 1 to 7 days. */
export const KICK_TIMEOUT_MAX_MINUTES = 10_080;

/** Kick refuses a ban or timeout reason longer than this. */
export const KICK_BAN_REASON_MAX_LENGTH = 100;

/** A ban or timeout as Kick takes it, or why Kick would refuse it. */
export type KickBan = { ok: true; durationMinutes: number | undefined } | { ok: false; error: string };

/**
 * Checks a ban (no duration) or timeout before it is sent, the same way for
 * the gateway and for `ctx.kick`: seconds round up to whole minutes, at most
 * 7 days, and a reason within Kick's limit.
 */
export function kickBan(durationSeconds: number | undefined, reason: string | undefined): KickBan {
  let durationMinutes: number | undefined;
  if (durationSeconds !== undefined) {
    if (!Number.isFinite(durationSeconds)) {
      return { ok: false, error: "a timeout's duration is a number of seconds" };
    }
    durationMinutes = Math.ceil(durationSeconds / 60);
    if (durationMinutes < 1 || durationMinutes > KICK_TIMEOUT_MAX_MINUTES) {
      return { ok: false, error: `a timeout is 1 to ${KICK_TIMEOUT_MAX_MINUTES * 60} seconds on Kick` };
    }
  }
  if (reason !== undefined && [...reason].length > KICK_BAN_REASON_MAX_LENGTH) {
    return { ok: false, error: `a ban or timeout reason is at most ${KICK_BAN_REASON_MAX_LENGTH} characters on Kick` };
  }
  return { ok: true, durationMinutes };
}

/**
 * The channel slugs a typed Kick name may be, most literal first. People type
 * the display name (`Pup_Pal`) while Kick's lookups take the slug, which is
 * lowercase and, as far as Kick's examples show, spells an underscore as a
 * hyphen; Kick does not document the rule, so both spellings are asked for.
 */
export function kickSlugCandidates(name: string): string[] {
  const lowered = name.trim().replace(/^@+/, "").toLowerCase();
  if (lowered === "") {
    return [];
  }
  return [...new Set([lowered, lowered.replace(/_/g, "-")])];
}
