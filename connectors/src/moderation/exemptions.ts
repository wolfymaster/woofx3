import type { Exemptions, RuleExemptions } from "@woofx3/api/moderation-config";
import type { ChatterMembership } from "@woofx3/common/cloudevents/Chat/events";

/**
 * Whether no rule acts on the speaker. The broadcaster always is. A role
 * counts only when the platform reported it: unknown membership exempts no
 * one by guess. A rule's own exemptions replace the config-wide ones they name.
 */
export function isExempt(
  membership: ChatterMembership | undefined,
  login: string,
  exempt: Exemptions,
  override: RuleExemptions | undefined
): boolean {
  if (membership?.isBroadcaster === true) {
    return true;
  }
  const effective = { ...exempt, ...override };
  if (effective.allowLogins.includes(login)) {
    return true;
  }
  if (membership === undefined) {
    return false;
  }
  return (
    (effective.moderators && membership.isModerator) ||
    (effective.vips && membership.isVip) ||
    (effective.subscribers && membership.isSubscriber)
  );
}

/**
 * Whether the speaker holds a role a timeout or ban must never touch, whatever
 * the exemptions say: the broadcaster, a moderator or a VIP. Unknown
 * membership counts as protected, since such a speaker may be any of them.
 */
export function isProtectedFromPunishment(membership: ChatterMembership | undefined): boolean {
  if (membership === undefined) {
    return true;
  }
  return membership.isBroadcaster || membership.isModerator || membership.isVip;
}
