import type { ChatterBadges } from "@woofx3/common/cloudevents/Twitch/events";
import type { DatabaseClient } from "./services/database";

/**
 * The built-in groups whose membership is derived from Twitch state. These
 * names mirror db/database/models/builtin_groups.go - the seeded catalog is the
 * contract between the two services.
 *
 * "everyone" is deliberately absent: it matches every user implicitly through
 * the Casbin wildcard subject and has no membership rows to maintain.
 */
export const TWITCH_DERIVED_GROUPS = ["subscriber", "vip", "moderator", "broadcaster"] as const;

export type TwitchDerivedGroup = (typeof TWITCH_DERIVED_GROUPS)[number];

/** Which badge decides membership of each Twitch-derived group. */
function badgeGroups(badges: ChatterBadges): Record<TwitchDerivedGroup, boolean> {
  return {
    subscriber: badges.isSubscriber,
    vip: badges.isVip,
    moderator: badges.isModerator,
    broadcaster: badges.isBroadcaster,
  };
}

interface Logger {
  info(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

/**
 * Keeps the built-in Twitch-derived groups in step with the badges Twitch puts
 * on each chat message.
 *
 * Twitch offers no roster to poll and no "sub lapsed" event we subscribe to, so
 * the badges on a message are the authoritative, continuously-refreshed signal.
 * The trade-off is volume: badges arrive on every message, and writing
 * membership per message would mean several db round trips per chat line.
 *
 * So this holds the last badge set seen per user and only writes when it
 * changes. A chatter's first message of a session costs one write per group
 * they belong to; every subsequent message costs nothing until their status
 * actually changes. State is per-process and intentionally not persisted - on
 * restart the first message from each chatter re-reconciles them, which is
 * cheap and self-healing.
 */
export class TwitchGroupSync {
  private readonly db: DatabaseClient;
  private readonly logger: Logger;
  private readonly applicationId: string;

  /** username -> the badge-derived membership last written for them. */
  private readonly lastSeen = new Map<string, Record<TwitchDerivedGroup, boolean>>();

  /** group name -> group id, resolved once from the seeded catalog. */
  private groupIds: Map<string, string> | null = null;

  constructor(db: DatabaseClient, applicationId: string, logger: Logger) {
    this.db = db;
    this.applicationId = applicationId;
    this.logger = logger;
  }

  /**
   * Reconcile one chatter against the badges on their message. Never throws:
   * a group-sync failure must not take down message handling, since the chat
   * pipeline's job is to answer the user, not to maintain permissions.
   */
  async reconcile(username: string, badges: ChatterBadges): Promise<void> {
    const user = username.trim().toLowerCase();
    if (user.length === 0) {
      return;
    }

    const desired = badgeGroups(badges);
    const previous = this.lastSeen.get(user);
    if (previous && TWITCH_DERIVED_GROUPS.every((group) => previous[group] === desired[group])) {
      return;
    }

    try {
      const ids = await this.resolveGroupIds();

      for (const group of TWITCH_DERIVED_GROUPS) {
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
      this.logger.error("failed to sync twitch-derived groups", { username: user, err });
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
