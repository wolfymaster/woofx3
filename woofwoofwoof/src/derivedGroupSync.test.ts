import { describe, expect, it, mock } from "bun:test";
import type { ChatterMembership } from "@woofx3/common/cloudevents/Chat/events";
import type { DatabaseClient } from "./services/database";
import { DerivedGroupSync } from "./derivedGroupSync";

function membership(overrides: Partial<ChatterMembership> = {}): ChatterMembership {
  return {
    isBroadcaster: false,
    isModerator: false,
    isSubscriber: false,
    isVip: false,
    ...overrides,
  };
}

const BUILT_IN_GROUPS = [
  { id: "g-everyone", name: "everyone", isBuiltIn: true },
  { id: "g-follower", name: "follower", isBuiltIn: true },
  { id: "g-subscriber", name: "subscriber", isBuiltIn: true },
  { id: "g-tier1", name: "subscriber_tier1", isBuiltIn: true },
  { id: "g-tier2", name: "subscriber_tier2", isBuiltIn: true },
  { id: "g-tier3", name: "subscriber_tier3", isBuiltIn: true },
  { id: "g-vip", name: "vip", isBuiltIn: true },
  { id: "g-moderator", name: "moderator", isBuiltIn: true },
  { id: "g-broadcaster", name: "broadcaster", isBuiltIn: true },
  { id: "g-regulars", name: "regulars", isBuiltIn: false },
];

function fakeDb() {
  const added: Array<{ groupId: string; username: string }> = [];
  const removed: Array<{ groupId: string; username: string }> = [];
  const listGroups = mock(async () => ({
    status: { code: "OK" as const },
    groups: BUILT_IN_GROUPS,
  }));
  const db = {
    listGroups,
    addUserToGroup: mock(async (req: { groupId: string; username: string }) => {
      added.push({ groupId: req.groupId, username: req.username });
      return { code: "OK" as const };
    }),
    removeUserFromGroup: mock(async (req: { groupId: string; username: string }) => {
      removed.push({ groupId: req.groupId, username: req.username });
      return { code: "OK" as const };
    }),
  };
  return { db: db as unknown as DatabaseClient, added, removed, listGroups, raw: db };
}

function fakeLogger() {
  return { info: mock(() => {}), error: mock(() => {}) };
}

function newSync(db: DatabaseClient) {
  return new DerivedGroupSync(db, "", fakeLogger());
}

describe("DerivedGroupSync", () => {
  it("adds the groups a chatter's badges grant and removes the rest", async () => {
    const { db, added, removed } = fakeDb();

    await newSync(db).reconcile("TrustedMod", membership({ isModerator: true, isSubscriber: true }));

    expect(added.map((a) => a.groupId).sort()).toEqual(["g-moderator", "g-subscriber"]);
    expect(removed.map((r) => r.groupId).sort()).toEqual(["g-broadcaster", "g-vip"]);
  });

  it("normalizes the username to lowercase", async () => {
    const { db, added } = fakeDb();

    await newSync(db).reconcile("  TrustedMod  ", membership({ isModerator: true }));

    expect(added[0].username).toBe("trustedmod");
  });

  // Badges arrive on every single chat message; writing membership each time
  // would mean several db round trips per chat line.
  it("does not write again when the badge set is unchanged", async () => {
    const { db, added, removed, raw } = fakeDb();
    const sync = newSync(db);

    await sync.reconcile("trustedmod", membership({ isModerator: true }));
    const writesAfterFirst = added.length + removed.length;

    await sync.reconcile("trustedmod", membership({ isModerator: true }));
    await sync.reconcile("trustedmod", membership({ isModerator: true }));

    expect(added.length + removed.length).toBe(writesAfterFirst);
    // The group catalog is resolved once, not per message.
    expect(raw.listGroups).toHaveBeenCalledTimes(1);
  });

  it("writes only the groups that actually changed", async () => {
    const { db, added, removed } = fakeDb();
    const sync = newSync(db);

    await sync.reconcile("chatter", membership({ isSubscriber: true }));
    added.length = 0;
    removed.length = 0;

    // Gains VIP, keeps the subscription.
    await sync.reconcile("chatter", membership({ isSubscriber: true, isVip: true }));

    expect(added).toEqual([{ groupId: "g-vip", username: "chatter" }]);
    expect(removed).toEqual([]);
  });

  it("removes membership when a badge goes away", async () => {
    const { db, added, removed } = fakeDb();
    const sync = newSync(db);

    await sync.reconcile("chatter", membership({ isSubscriber: true }));
    added.length = 0;
    removed.length = 0;

    await sync.reconcile("chatter", membership({ isSubscriber: false }));

    // Losing the subscriber badge also settles every tier group: they are in
    // none of them, and that needs no lookup to establish.
    expect(removed.map((r) => r.groupId).sort()).toEqual(["g-subscriber", "g-tier1", "g-tier2", "g-tier3"]);
  });

  it("never syncs the everyone group, which has no membership rows", async () => {
    const { db, added, removed } = fakeDb();

    await newSync(db).reconcile("chatter", membership({ isBroadcaster: true }));

    const touched = [...added, ...removed].map((x) => x.groupId);
    expect(touched).not.toContain("g-everyone");
  });

  it("ignores non-built-in groups that happen to share a name", async () => {
    const { db, added, removed } = fakeDb();

    await newSync(db).reconcile("chatter", membership({ isModerator: true }));

    const touched = [...added, ...removed].map((x) => x.groupId);
    expect(touched).not.toContain("g-regulars");
  });

  // A permissions write failing must not take down chat handling, and must not
  // be remembered as applied.
  it("swallows write failures and retries on the next message", async () => {
    const { db, raw } = fakeDb();
    let failNext = true;
    raw.addUserToGroup = mock(async () => {
      if (failNext) {
        failNext = false;
        throw new Error("db unavailable");
      }
      return { code: "OK" as const };
    });
    const sync = newSync(db);

    await sync.reconcile("chatter", membership({ isModerator: true }));
    await sync.reconcile("chatter", membership({ isModerator: true }));

    expect(raw.addUserToGroup).toHaveBeenCalledTimes(2);
  });
  describe("follower", () => {
    // Twitch has no follower badge, so an unresolved lookup is the normal case
    // rather than an error, and must not read as "not a follower".
    it("does not write the follower group when the platform did not answer", async () => {
      const { db, added, removed } = fakeDb();

      await newSync(db).reconcile("chatter", membership());

      const touched = [...added, ...removed].map((x) => x.groupId);
      expect(touched).not.toContain("g-follower");
    });

    it("adds the follower group when the lookup resolved true", async () => {
      const { db, added } = fakeDb();

      await newSync(db).reconcile("chatter", membership({ isFollower: true }));

      expect(added.map((a) => a.groupId)).toContain("g-follower");
    });

    it("removes the follower group when the lookup resolved false", async () => {
      const { db, removed } = fakeDb();

      await newSync(db).reconcile("chatter", membership({ isFollower: false }));

      expect(removed.map((r) => r.groupId)).toContain("g-follower");
    });

    // A transient Helix blip must not demote a known follower - the row would
    // persist until their next message.
    it("keeps a known follower when a later lookup does not resolve", async () => {
      const { db, added, removed } = fakeDb();
      const sync = newSync(db);

      await sync.reconcile("chatter", membership({ isFollower: true }));
      added.length = 0;
      removed.length = 0;

      await sync.reconcile("chatter", membership({ isFollower: undefined }));

      expect(removed.map((r) => r.groupId)).not.toContain("g-follower");
    });

    it("still recognises a resolved answer after an unresolved one", async () => {
      const { db, added, removed } = fakeDb();
      const sync = newSync(db);

      await sync.reconcile("chatter", membership({ isFollower: true }));
      await sync.reconcile("chatter", membership({ isFollower: undefined }));
      added.length = 0;
      removed.length = 0;

      await sync.reconcile("chatter", membership({ isFollower: false }));

      expect(removed.map((r) => r.groupId)).toContain("g-follower");
    });
  });

  describe("subscription tiers", () => {
    // A grant to plain "subscriber" has to keep matching every subscriber, so
    // a tier N subscriber belongs to both groups.
    it("writes a tier subscriber into both subscriber and the tier group", async () => {
      const { db, added } = fakeDb();

      await newSync(db).reconcile("chatter", membership({ isSubscriber: true, subscriberTier: "tier2" }));

      expect(added.map((a) => a.groupId).sort()).toEqual(["g-subscriber", "g-tier2"]);
    });

    it("clears the other tiers when a tier resolves", async () => {
      const { db, removed } = fakeDb();

      await newSync(db).reconcile("chatter", membership({ isSubscriber: true, subscriberTier: "tier2" }));

      expect(removed.map((r) => r.groupId)).toEqual(expect.arrayContaining(["g-tier1", "g-tier3"]));
    });

    it("leaves the tier groups alone for a subscriber whose tier did not resolve", async () => {
      const { db, added, removed } = fakeDb();

      await newSync(db).reconcile("chatter", membership({ isSubscriber: true }));

      const touched = [...added, ...removed].map((x) => x.groupId);
      expect(touched).not.toContain("g-tier1");
      expect(touched).not.toContain("g-tier2");
      expect(touched).not.toContain("g-tier3");
    });

    // Ordering tier groups would mean the engine knowing each platform's tier
    // hierarchy. It does not, so an unrecognised token matches no seeded group.
    it("puts an unrecognised tier token in no tier group", async () => {
      const { db, added } = fakeDb();

      await newSync(db).reconcile("chatter", membership({ isSubscriber: true, subscriberTier: "prime" }));

      expect(added.map((a) => a.groupId)).toEqual(["g-subscriber"]);
    });

    it("moves the chatter when their tier changes", async () => {
      const { db, added, removed } = fakeDb();
      const sync = newSync(db);

      await sync.reconcile("chatter", membership({ isSubscriber: true, subscriberTier: "tier1" }));
      added.length = 0;
      removed.length = 0;

      await sync.reconcile("chatter", membership({ isSubscriber: true, subscriberTier: "tier3" }));

      expect(added.map((a) => a.groupId)).toEqual(["g-tier3"]);
      expect(removed.map((r) => r.groupId)).toEqual(["g-tier1"]);
    });

    // A platform with no tiers leaves them empty rather than guessing.
    it("does not invent a tier for a platform that reports none", async () => {
      const { db, added } = fakeDb();

      await newSync(db).reconcile("chatter", membership({ isSubscriber: true }));

      expect(added.map((a) => a.groupId)).toEqual(["g-subscriber"]);
    });
  });
});
