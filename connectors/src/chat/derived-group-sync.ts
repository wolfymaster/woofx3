import type { ChatterMembership } from "@woofx3/common/cloudevents/Chat/events";
import { type Clock, errorMessage, type Logger } from "../host/deps";
import { BoundedMap } from "./bounded-map";
import type { DispatcherDb } from "./db-client";
import { type ViewerKey, viewerKeyString } from "./viewer";

/**
 * The built-in groups whose membership is derived from the platform rather
 * than managed by hand. Must match db/database/models/builtin_groups.go: the
 * seeded catalog is the contract between the two services.
 *
 * "everyone" is absent on purpose: it matches every user through the Casbin
 * wildcard subject and has no membership rows to maintain.
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
 * What the platform says about one chatter's derived groups. A group is
 * absent when the platform did not answer for it. Absent is not false:
 * writing "not a member" on an unresolved lookup would demote a real
 * follower on a transient blip until their next message.
 */
export type DerivedMembership = Partial<Record<DerivedGroup, boolean>>;

/** The tier groups; a tier token on the membership (`"tier2"`) selects `subscriber_tier2`. */
const TIER_GROUPS = ["subscriber_tier1", "subscriber_tier2", "subscriber_tier3"] as const;

function tierGroupFor(token: string): DerivedGroup | undefined {
  const name = `subscriber_${token}`;
  return TIER_GROUPS.find((group) => group === name);
}

/** Which membership signal decides each derived group. */
export function membershipGroups(membership: ChatterMembership): DerivedMembership {
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
    // Not subscribed is a definite answer for every tier.
    for (const group of TIER_GROUPS) {
      groups[group] = false;
    }
  } else if (membership.subscriberTier !== undefined) {
    // A resolved tier is exclusive. An unrecognised token leaves the chatter
    // in none of the seeded tier groups rather than guessing which it means.
    const resolved = tierGroupFor(membership.subscriberTier);
    for (const group of TIER_GROUPS) {
      groups[group] = group === resolved;
    }
  }
  // Subscribed with the tier unresolved: the tier groups stay absent and keep
  // whatever was last written.
  return groups;
}

export interface DerivedGroupSyncConfig {
  /** Viewers whose last written membership is remembered; the least recent is forgotten first. */
  lastSeenCapacity: number;
  /** How long the built-in group catalog is used before it is read again. */
  catalogTtlMs: number;
}

/** Why a reconcile wrote nothing, or that it wrote. */
export type ReconcileOutcome = "unchanged" | "written" | "failed";

/**
 * Keeps the built-in derived groups in step with the membership reported
 * on each trusted chat line.
 *
 * A platform need not offer a roster or any "membership lapsed" event, so
 * the membership on a line is the continuously refreshed signal. Writing it
 * per line would cost several db round trips per chat line, so the last
 * membership written per viewer is remembered and only a change is written.
 * The memory is bounded: a viewer it forgot costs one rewrite on their next
 * line, which is cheap and self-healing, as is a restart.
 *
 * Group rows key on the speaker's login (db-proxy's identity); the memory
 * keys on the viewer's platform id, so a renamed or look-alike account never
 * reuses another's entry.
 */
export class DerivedGroupSync {
  private readonly lastSeen: BoundedMap<string, DerivedMembership>;
  /** Group name to id, from the seeded catalog, and when it was read. */
  private catalog: { ids: Map<string, string>; readAt: number } | undefined;

  constructor(
    private readonly db: Pick<DispatcherDb, "listBuiltInGroups" | "addUserToGroup" | "removeUserFromGroup">,
    private readonly config: DerivedGroupSyncConfig,
    private readonly clock: Clock,
    private readonly logger: Logger
  ) {
    if (!(Number.isInteger(config.catalogTtlMs) && config.catalogTtlMs > 0)) {
      throw new Error(
        `the group catalog TTL must be a whole number of milliseconds above 0, got ${config.catalogTtlMs}`
      );
    }
    this.lastSeen = new BoundedMap({ capacity: config.lastSeenCapacity }, clock);
  }

  /** Viewers remembered. */
  get remembered(): number {
    return this.lastSeen.size;
  }

  /**
   * Reconciles one viewer. Never throws: group sync must not take down
   * command handling. A failure forgets the viewer, so their next line
   * retries rather than treating the failed write as applied.
   */
  async reconcile(viewer: ViewerKey, chatterLogin: string, membership: ChatterMembership): Promise<ReconcileOutcome> {
    const key = viewerKeyString(viewer);
    const login = chatterLogin.trim().toLowerCase();
    if (login === "") {
      return "unchanged";
    }
    const desired = membershipGroups(membership);
    const previous = this.lastSeen.get(key);
    if (
      previous !== undefined &&
      DERIVED_GROUPS.every((group) => desired[group] === undefined || previous[group] === desired[group])
    ) {
      return "unchanged";
    }
    try {
      const ids = await this.groupIds();
      const written: DerivedMembership = { ...previous };
      for (const group of DERIVED_GROUPS) {
        const want = desired[group];
        if (want === undefined || previous?.[group] === want) {
          continue;
        }
        const groupId = ids.get(group);
        if (groupId !== undefined) {
          if (want) {
            await this.db.addUserToGroup(groupId, login);
          } else {
            await this.db.removeUserFromGroup(groupId, login);
          }
        }
        // Recorded even when the catalog lacks the group: an engine whose
        // seeded groups predate it has nothing to write, and retrying it on
        // every line would be noise.
        written[group] = want;
      }
      this.lastSeen.set(key, written);
      return "written";
    } catch (error) {
      this.lastSeen.delete(key);
      this.logger.error("could not sync a viewer's derived groups", {
        platform: viewer.platform,
        platformUserId: viewer.platformUserId,
        error: errorMessage(error),
      });
      return "failed";
    }
  }

  private async groupIds(): Promise<Map<string, string>> {
    const now = this.clock.now();
    if (this.catalog !== undefined && now - this.catalog.readAt < this.config.catalogTtlMs) {
      return this.catalog.ids;
    }
    const ids = await this.db.listBuiltInGroups();
    this.catalog = { ids, readAt: now };
    return ids;
  }
}
