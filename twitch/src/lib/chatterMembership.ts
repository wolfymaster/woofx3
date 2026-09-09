import type { ApiClient } from "@twurple/api";
import type { ChatterMembership } from "@woofx3/common/cloudevents/Chat/events";

/**
 * The two membership facts Twitch does not stamp on a chat message.
 *
 * Kept as a port rather than reaching for `ApiClient` directly so the caching
 * and deadline behaviour above it can be tested without a Twitch token, and so
 * a future platform adapter can supply the same answers from wherever it
 * actually keeps them.
 */
export interface MembershipLookup {
  /** Whether `userId` follows `broadcasterId`. */
  isFollower(broadcasterId: string, userId: string): Promise<boolean>;

  /**
   * The chatter's tier as a neutral token (`"tier1"`), or null when they hold
   * no subscription. Translating the platform's own codes is this layer's job.
   */
  subscriberTier(broadcasterId: string, userId: string): Promise<string | null>;
}

/**
 * Twitch reports tiers as the plan codes "1000"/"2000"/"3000". They stop here:
 * everything downstream sees the neutral token, so no consumer has to know
 * that Twitch numbers its tiers in thousands.
 *
 * Twitch Prime is not represented. Get Broadcaster Subscriptions reports a
 * Prime subscription as tier "1000" with no field distinguishing it from a
 * paid tier 1 (`plan_name` is a display string, not a flag), so a "prime"
 * group could not be populated honestly from this endpoint.
 */
const TWITCH_TIER_TOKENS: Record<string, string> = {
  "1000": "tier1",
  "2000": "tier2",
  "3000": "tier3",
};

export class TwurpleMembershipLookup implements MembershipLookup {
  constructor(private readonly api: ApiClient) {}

  async isFollower(broadcasterId: string, userId: string): Promise<boolean> {
    const followers = await this.api.channels.getChannelFollowers(broadcasterId, userId);
    return followers.data.length > 0;
  }

  async subscriberTier(broadcasterId: string, userId: string): Promise<string | null> {
    const subscription = await this.api.subscriptions.getSubscriptionForUser(broadcasterId, userId);
    if (!subscription) {
      return null;
    }
    // An unrecognised code is reported as-is rather than dropped: the group
    // sync will simply match no seeded tier group, which is visible and
    // correctable, where silently returning null would read as "not
    // subscribed" and contradict the badge.
    return TWITCH_TIER_TOKENS[subscription.tier] ?? subscription.tier;
  }
}

export interface EnricherOptions {
  /** How long a resolved answer is trusted. Unfollows raise no event, so a TTL is the only thing that expires one. */
  ttlMs: number;
  /** How long the enricher waits on a cache miss before publishing without the field. */
  deadlineMs: number;
  /** How long a failed lookup is remembered, so a missing scope does not mean one request per chat message. */
  failureTtlMs: number;
  /** Cap on cached chatters, so a raid cannot grow the cache without bound. */
  maxEntries: number;
}

export const DEFAULT_ENRICHER_OPTIONS: EnricherOptions = {
  ttlMs: 10 * 60 * 1000,
  deadlineMs: 250,
  failureTtlMs: 60 * 1000,
  maxEntries: 5000,
};

interface Logger {
  warn(message: string, meta?: unknown): void;
}

interface CacheEntry<T> {
  /** undefined records a failed lookup: cached, but not an answer. */
  value: T | undefined;
  expiresAt: number;
}

/**
 * A TTL cache over one out-of-band lookup, with in-flight de-duplication and a
 * bounded wait.
 *
 * Chat is the hot path. A per-message uncached lookup would exhaust Helix rate
 * limits immediately, and a slow or failed one must never stall the pipeline -
 * so a miss waits only until the deadline and then gives up, leaving the
 * in-flight request to populate the cache for the chatter's next message.
 */
class LookupCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly inFlight = new Map<string, Promise<T | undefined>>();

  constructor(
    private readonly load: (broadcasterId: string, userId: string) => Promise<T>,
    private readonly options: EnricherOptions,
    private readonly onFailure: (err: unknown) => void
  ) {}

  /**
   * The answer for this chatter, or undefined when there is none to be had
   * within the deadline - still in flight, or a recent failure.
   */
  async resolve(broadcasterId: string, userId: string): Promise<T | undefined> {
    const key = `${broadcasterId}:${userId}`;
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const pending = this.inFlight.get(key) ?? this.start(key, broadcasterId, userId);
    return await withDeadline(pending, this.options.deadlineMs);
  }

  private start(key: string, broadcasterId: string, userId: string): Promise<T | undefined> {
    const pending = this.load(broadcasterId, userId)
      .then((value) => {
        this.store(key, value, this.options.ttlMs);
        return value;
      })
      .catch((err) => {
        this.onFailure(err);
        this.store(key, undefined, this.options.failureTtlMs);
        return undefined;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, pending);
    return pending;
  }

  private store(key: string, value: T | undefined, ttlMs: number): void {
    const now = Date.now();
    // Re-inserting refreshes the key's position, so eviction below drops
    // the least recently written rather than the least recently seen.
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: now + ttlMs });

    if (this.entries.size <= this.options.maxEntries) {
      return;
    }
    // Only ever runs on a full cache: drop what has expired, then the
    // least recently written, until back under the cap.
    for (const [existing, entry] of this.entries) {
      if (this.entries.size <= this.options.maxEntries) {
        return;
      }
      if (entry.expiresAt <= now) {
        this.entries.delete(existing);
      }
    }
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) {
        return;
      }
      this.entries.delete(oldest.value);
    }
  }
}

/** Resolve with undefined if `promise` has not settled within `ms`. */
function withDeadline<T>(promise: Promise<T | undefined>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    // Unreferenced so a pending deadline never holds the process open
    // during shutdown.
    const timer = setTimeout(() => resolve(undefined), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      }
    );
  });
}

/**
 * Fills in the membership fields a chat message cannot carry.
 *
 * Twitch has no follower badge at all, and the subscriber badge's version
 * encodes tier and months by a brittle convention, so both are read from Helix
 * instead. That happens here, inside the platform adapter and before publish,
 * so consumers stay ignorant of how membership was obtained.
 *
 * A field that does not resolve is left absent rather than false - see the
 * note on `ChatterMembership`.
 */
export class ChatterMembershipEnricher {
  private readonly followers: LookupCache<boolean>;
  private readonly tiers: LookupCache<string | null>;

  constructor(lookup: MembershipLookup, logger: Logger, options: EnricherOptions = DEFAULT_ENRICHER_OPTIONS) {
    this.followers = new LookupCache(
      (broadcasterId, userId) => lookup.isFollower(broadcasterId, userId),
      options,
      (err) => logger.warn("twitch: follower lookup failed", { err })
    );
    this.tiers = new LookupCache(
      (broadcasterId, userId) => lookup.subscriberTier(broadcasterId, userId),
      options,
      (err) => logger.warn("twitch: subscription lookup failed", { err })
    );
  }

  async enrich(broadcasterId: string, userId: string, membership: ChatterMembership): Promise<ChatterMembership> {
    // The badge already answers "is this a subscriber". Only the tier is
    // unknown, so a non-subscriber costs no subscription request at all.
    const [isFollower, tier] = await Promise.all([
      this.followers.resolve(broadcasterId, userId),
      membership.isSubscriber ? this.tiers.resolve(broadcasterId, userId) : Promise.resolve(undefined),
    ]);

    const enriched: ChatterMembership = { ...membership };
    if (isFollower !== undefined) {
      enriched.isFollower = isFollower;
    }
    if (tier !== undefined && tier !== null) {
      enriched.subscriberTier = tier;
    }
    return enriched;
  }
}
