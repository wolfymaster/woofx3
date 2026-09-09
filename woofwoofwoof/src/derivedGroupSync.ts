import type { ChatterMembership } from "@woofx3/common/cloudevents/Chat/events";
import type { DatabaseClient } from "./services/database";

/**
 * The built-in groups whose membership is derived from the platform rather
 * than managed by hand. These names mirror db/database/models/builtin_groups.go
 * - the seeded catalog is the contract between the two services.
 *
 * "everyone" is deliberately absent: it matches every user implicitly through
 * the Casbin wildcard subject and has no membership rows to maintain.
 */
export const DERIVED_GROUPS = [
  "follower",
  "subscriber",
  "subscriber_tier1",
  "subscriber_tier2",
  "subscriber_tier3",
  "vip",
  "moderator",
  "broadcaster",
] as const;

export type DerivedGroup = (typeof DERIVED_GROUPS)[number];

/**
 * What the platform says about one chatter's derived groups.
 *
 * A group is absent when the platform did not answer for it - it does not
 * report the signal, or the lookup did not resolve. Absent is not `false`:
 * writing "not a member" on an unresolved lookup would demote a real follower
 * on a transient Helix blip, and the row would persist until their next
 * message. Callers must skip absent groups, never default them.
 */
export type DerivedMembership = Partial<Record<DerivedGroup, boolean>>;

/**
 * The tier groups, in the order the catalog seeds them. A tier is selected by
 * the neutral token on the membership (`"tier2"` -> `subscriber_tier2`); the
 * platform adapter is what translates its own codes into that token.
 */
const TIER_GROUPS = ["subscriber_tier1", "subscriber_tier2", "subscriber_tier3"] as const;

function tierGroupFor(token: string): DerivedGroup | undefined {
  const name = `subscriber_${token}`;
  return TIER_GROUPS.find((group) => group === name);
}

/** Which membership signal decides each derived group. */
function membershipGroups(membership: ChatterMembership): DerivedMembership {
  const groups: DerivedMembership = {
    subscriber: membership.isSubscriber,
    vip: membership.isVip,
    moderator: membership.isModerator,
    broadcaster: membership.isBroadcaster,
  };

  if (membership.isFollower !== undefined) {
    groups.follower = membership.isFollower;
  }

  if (!membership.isSubscriber) {
    // Not subscribed is a definite answer for every tier: they are in none of
    // them. No lookup needed, and no lookup can contradict it.
    for (const group of TIER_GROUPS) {
      groups[group] = false;
    }
  } else if (membership.subscriberTier !== undefined) {
    // A resolved tier is exclusive - one tier group in, the rest out. An
    // unrecognised token leaves the chatter in none of the seeded tier groups,
    // which is the honest answer rather than a guess at which one it means.
    const resolved = tierGroupFor(membership.subscriberTier);
    for (const group of TIER_GROUPS) {
      groups[group] = group === resolved;
    }
  }
  // Subscribed but tier unresolved: leave the tier groups absent. They keep
  // whatever was last written rather than being cleared by a failed lookup.

  return groups;
}

interface Logger {
  info(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

/**
 * Keeps the built-in derived groups in step with the membership reported on
 * each chat message.
 *
 * The platform is not required to offer a queryable roster, and may report no
 * "membership lapsed" event at all, so the membership carried on a message is
 * the authoritative, continuously-refreshed signal. The trade-off is volume:
 * it arrives on every message, and writing membership per message would mean
 * several db round trips per chat line.
 *
 * So this holds the last membership seen per user and only writes when it
 * changes. A chatter's first message of a session costs one write per group
 * they belong to; every subsequent message costs nothing until their status
 * actually changes. State is per-process and intentionally not persisted - on
 * restart the first message from each chatter re-reconciles them, which is
 * cheap and self-healing.
 *
 * Groups the platform did not answer for are skipped rather than written as
 * "not a member", and the cache keeps the last value actually written for
 * them, so an unresolved lookup costs nothing and a later resolved one is
 * still recognised as a change.
 */
export class DerivedGroupSync {
  private readonly db: DatabaseClient;
  private readonly logger: Logger;
  private readonly applicationId: string;

  /** username -> the derived membership last written for them. */
  private readonly lastSeen = new Map<string, DerivedMembership>();

  /** group name -> group id, resolved once from the seeded catalog. */
  private groupIds: Map<string, string> | null = null;

  constructor(db: DatabaseClient, applicationId: string, logger: Logger) {
    this.db = db;
    this.applicationId = applicationId;
    this.logger = logger;
  }

  /**
   * Reconcile one chatter against the membership on their message. Never throws:
   * a group-sync failure must not take down message handling, since the chat
   * pipeline's job is to answer the user, not to maintain permissions.
   */
  async reconcile(username: string, membership: ChatterMembership): Promise<void> {
    const user = username.trim().toLowerCase();
    if (user.length === 0) {
      return;
    }

    const desired = membershipGroups(membership);
    const previous = this.lastSeen.get(user);
    if (
      previous &&
      DERIVED_GROUPS.every((group) => desired[group] === undefined || previous[group] === desired[group])
    ) {
      return;
    }

    try {
      const ids = await this.resolveGroupIds();
      const written: DerivedMembership = { ...previous };

      for (const group of DERIVED_GROUPS) {
        const want = desired[group];
        if (want === undefined) {
          continue;
        }
        if (previous && previous[group] === want) {
          continue;
        }
        const groupId = ids.get(group);
        if (groupId) {
          const req = { applicationId: this.applicationId, groupId, username: user };
          if (want) {
            await this.db.addUserToGroup(req);
          } else {
            await this.db.removeUserFromGroup(req);
          }
        }
        // Recorded either way. A group missing from the catalog means the
        // application predates it and has not been migrated - there is nothing
        // to write, so retrying it on every message would be pure noise.
        written[group] = want;
      }

      this.lastSeen.set(user, written);
    } catch (err) {
      // Drop the cache entry so the next message retries rather than treating
      // a failed write as applied.
      this.lastSeen.delete(user);
      this.logger.error("failed to sync derived groups", { username: user, err });
    }
  }

  private async resolveGroupIds(): Promise<Map<string, string>> {
    if (this.groupIds) {
      return this.groupIds;
    }
    const response = await this.db.listGroups({ applicationId: this.applicationId });
    if (response.status?.code !== "OK") {
      throw new Error(response.status?.message || "failed to list groups");
    }
    const ids = new Map<string, string>();
    for (const group of response.groups ?? []) {
      if (group.isBuiltIn) {
        ids.set(group.name, group.id);
      }
    }
    this.groupIds = ids;
    return ids;
  }
}
