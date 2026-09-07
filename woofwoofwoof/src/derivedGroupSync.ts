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
export const DERIVED_GROUPS = ["subscriber", "vip", "moderator", "broadcaster"] as const;

export type DerivedGroup = (typeof DERIVED_GROUPS)[number];

/** Which membership flag decides each derived group. */
function membershipGroups(membership: ChatterMembership): Record<DerivedGroup, boolean> {
  return {
    subscriber: membership.isSubscriber,
    vip: membership.isVip,
    moderator: membership.isModerator,
    broadcaster: membership.isBroadcaster,
  };
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
 */
export class DerivedGroupSync {
  private readonly db: DatabaseClient;
  private readonly logger: Logger;
  private readonly applicationId: string;

  /** username -> the derived membership last written for them. */
  private readonly lastSeen = new Map<string, Record<DerivedGroup, boolean>>();

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
    if (previous && DERIVED_GROUPS.every((group) => previous[group] === desired[group])) {
      return;
    }

    try {
      const ids = await this.resolveGroupIds();

      for (const group of DERIVED_GROUPS) {
        if (previous && previous[group] === desired[group]) {
          continue;
        }
        const groupId = ids.get(group);
        if (!groupId) {
          // The application predates the built-in catalog and has not been
          // migrated. Skip rather than invent a group.
          continue;
        }
        const req = { applicationId: this.applicationId, groupId, username: user };
        if (desired[group]) {
          await this.db.addUserToGroup(req);
        } else {
          await this.db.removeUserFromGroup(req);
        }
      }

      this.lastSeen.set(user, desired);
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
