import { describe, expect, it, mock } from "bun:test";
import type { ChatterMembership } from "@woofx3/common/cloudevents/Chat/events";
import { ChatterMembershipEnricher, DEFAULT_ENRICHER_OPTIONS, type MembershipLookup } from "./chatterMembership";

const BROADCASTER = "b1";
const CHATTER = "u1";

function badged(overrides: Partial<ChatterMembership> = {}): ChatterMembership {
  return {
    isBroadcaster: false,
    isModerator: false,
    isSubscriber: false,
    isVip: false,
    ...overrides,
  };
}

function fakeLogger() {
  return { warn: mock(() => {}) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeLookup(overrides: Partial<MembershipLookup> = {}) {
  const lookup: MembershipLookup = {
    isFollower: mock(async () => true),
    subscriberTier: mock(async () => "tier2"),
    ...overrides,
  };
  return lookup;
}

function newEnricher(lookup: MembershipLookup, options: Partial<typeof DEFAULT_ENRICHER_OPTIONS> = {}) {
  return new ChatterMembershipEnricher(lookup, fakeLogger(), { ...DEFAULT_ENRICHER_OPTIONS, ...options });
}

describe("ChatterMembershipEnricher", () => {
  it("fills in follower and tier from the out-of-band lookups", async () => {
    const enriched = await newEnricher(fakeLookup()).enrich(BROADCASTER, CHATTER, badged({ isSubscriber: true }));

    expect(enriched.isFollower).toBe(true);
    expect(enriched.subscriberTier).toBe("tier2");
  });

  it("leaves the badge-derived flags untouched", async () => {
    const enriched = await newEnricher(fakeLookup()).enrich(
      BROADCASTER,
      CHATTER,
      badged({ isModerator: true, isVip: true })
    );

    expect(enriched.isModerator).toBe(true);
    expect(enriched.isVip).toBe(true);
    expect(enriched.isSubscriber).toBe(false);
  });

  // The badge already answers "is this a subscriber", so there is nothing a
  // subscription request could add for a non-subscriber.
  it("does not look up a tier for a chatter with no subscriber badge", async () => {
    const lookup = fakeLookup();

    const enriched = await newEnricher(lookup).enrich(BROADCASTER, CHATTER, badged({ isSubscriber: false }));

    expect(lookup.subscriberTier).not.toHaveBeenCalled();
    expect(enriched.subscriberTier).toBeUndefined();
  });

  it("reports no tier for a chatter Helix says is not subscribed", async () => {
    const lookup = fakeLookup({ subscriberTier: mock(async () => null) });

    const enriched = await newEnricher(lookup).enrich(BROADCASTER, CHATTER, badged({ isSubscriber: true }));

    expect(enriched.subscriberTier).toBeUndefined();
  });

  // A slow lookup must never stall the chat pipeline.
  it("publishes without the field when the lookup misses the deadline", async () => {
    const pending = deferred<boolean>();
    const lookup = fakeLookup({ isFollower: mock(() => pending.promise) });

    const enriched = await newEnricher(lookup, { deadlineMs: 5 }).enrich(BROADCASTER, CHATTER, badged());

    expect(enriched.isFollower).toBeUndefined();
    pending.resolve(true);
  });

  // The request the deadline abandoned still populates the cache, so the
  // chatter's next line is answered.
  it("serves a late answer from the cache on the next message", async () => {
    const pending = deferred<boolean>();
    const lookup = fakeLookup({ isFollower: mock(() => pending.promise) });
    const enricher = newEnricher(lookup, { deadlineMs: 5 });

    expect((await enricher.enrich(BROADCASTER, CHATTER, badged())).isFollower).toBeUndefined();
    pending.resolve(true);
    await pending.promise;

    expect((await enricher.enrich(BROADCASTER, CHATTER, badged())).isFollower).toBe(true);
    expect(lookup.isFollower).toHaveBeenCalledTimes(1);
  });

  it("caches a resolved answer instead of asking once per message", async () => {
    const lookup = fakeLookup();
    const enricher = newEnricher(lookup);

    await enricher.enrich(BROADCASTER, CHATTER, badged());
    await enricher.enrich(BROADCASTER, CHATTER, badged());
    await enricher.enrich(BROADCASTER, CHATTER, badged());

    expect(lookup.isFollower).toHaveBeenCalledTimes(1);
  });

  it("re-asks once the answer has expired", async () => {
    const lookup = fakeLookup();
    const enricher = newEnricher(lookup, { ttlMs: 1 });

    await enricher.enrich(BROADCASTER, CHATTER, badged());
    await Bun.sleep(5);
    await enricher.enrich(BROADCASTER, CHATTER, badged());

    expect(lookup.isFollower).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent messages from one chatter into a single lookup", async () => {
    const pending = deferred<boolean>();
    const lookup = fakeLookup({ isFollower: mock(() => pending.promise) });
    const enricher = newEnricher(lookup);

    const inFlight = [
      enricher.enrich(BROADCASTER, CHATTER, badged()),
      enricher.enrich(BROADCASTER, CHATTER, badged()),
      enricher.enrich(BROADCASTER, CHATTER, badged()),
    ];
    pending.resolve(true);
    const results = await Promise.all(inFlight);

    expect(lookup.isFollower).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.isFollower)).toEqual([true, true, true]);
  });

  it("keeps chatters apart", async () => {
    const lookup = fakeLookup();
    const enricher = newEnricher(lookup);

    await enricher.enrich(BROADCASTER, "u1", badged());
    await enricher.enrich(BROADCASTER, "u2", badged());

    expect(lookup.isFollower).toHaveBeenCalledTimes(2);
  });

  // A missing scope or a dead token fails every time. Retrying per message
  // would burn the rate limit for nothing.
  it("does not retry a failed lookup on every message", async () => {
    const lookup = fakeLookup({
      isFollower: mock(async () => {
        throw new Error("401 missing scope");
      }),
    });
    const enricher = newEnricher(lookup);

    const first = await enricher.enrich(BROADCASTER, CHATTER, badged());
    const second = await enricher.enrich(BROADCASTER, CHATTER, badged());

    expect(first.isFollower).toBeUndefined();
    expect(second.isFollower).toBeUndefined();
    expect(lookup.isFollower).toHaveBeenCalledTimes(1);
  });

  it("retries once the failure backoff has passed", async () => {
    let calls = 0;
    const lookup = fakeLookup({
      isFollower: mock(async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error("transient");
        }
        return true;
      }),
    });
    const enricher = newEnricher(lookup, { failureTtlMs: 1 });

    expect((await enricher.enrich(BROADCASTER, CHATTER, badged())).isFollower).toBeUndefined();
    await Bun.sleep(5);
    expect((await enricher.enrich(BROADCASTER, CHATTER, badged())).isFollower).toBe(true);
  });

  it("evicts the least recently written chatter once the cache is full", async () => {
    const lookup = fakeLookup();
    const enricher = newEnricher(lookup, { maxEntries: 2 });

    await enricher.enrich(BROADCASTER, "u1", badged());
    await enricher.enrich(BROADCASTER, "u2", badged());
    await enricher.enrich(BROADCASTER, "u3", badged());
    // u1 is gone; u3 is still cached.
    await enricher.enrich(BROADCASTER, "u3", badged());
    await enricher.enrich(BROADCASTER, "u1", badged());

    expect(lookup.isFollower).toHaveBeenCalledTimes(4);
  });
});
