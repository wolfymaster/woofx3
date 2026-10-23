import { beforeEach, describe, expect, test } from "bun:test";
import type { ChatterMembership } from "@woofx3/common/cloudevents/Chat/events";
import { FakeTime, RecordingLogger } from "../host/testing";
import { DerivedGroupSync, membershipGroups } from "./derived-group-sync";
import { FakeDispatcherDb, MODERATOR, NO_ROLES } from "./testing";
import { viewerKey } from "./viewer";

const VIEWER = viewerKey("twitch", "v-1");

describe("membershipGroups", () => {
  const cases: Array<{ name: string; membership: ChatterMembership; expected: Record<string, boolean | undefined> }> = [
    {
      name: "not subscribed rules out every tier",
      membership: NO_ROLES,
      expected: { subscriber_tier1: false, subscriber_tier2: false, subscriber_tier3: false, follower: undefined },
    },
    {
      name: "a resolved tier is exclusive",
      membership: { ...NO_ROLES, isSubscriber: true, subscriberTier: "tier2" },
      expected: { subscriber_tier1: false, subscriber_tier2: true, subscriber_tier3: false },
    },
    {
      name: "an unknown tier token is in no tier group",
      membership: { ...NO_ROLES, isSubscriber: true, subscriberTier: "tier9" },
      expected: { subscriber_tier1: false, subscriber_tier2: false, subscriber_tier3: false },
    },
    {
      name: "subscribed with no tier leaves the tiers absent",
      membership: { ...NO_ROLES, isSubscriber: true },
      expected: { subscriber: true, subscriber_tier1: undefined, subscriber_tier2: undefined },
    },
    {
      name: "a reported follow is written either way",
      membership: { ...NO_ROLES, isFollower: false },
      expected: { follower: false },
    },
  ];
  for (const { name, membership, expected } of cases) {
    test(name, () => {
      const groups = membershipGroups(membership);
      for (const [group, value] of Object.entries(expected)) {
        expect(groups[group as keyof typeof groups]).toBe(value);
      }
    });
  }
});

describe("DerivedGroupSync", () => {
  let db: FakeDispatcherDb;
  let time: FakeTime;
  let sync: DerivedGroupSync;

  beforeEach(() => {
    db = new FakeDispatcherDb();
    time = new FakeTime();
    sync = new DerivedGroupSync(db, { lastSeenCapacity: 2, catalogTtlMs: 300_000 }, time, new RecordingLogger());
  });

  test("writes by login, and only what changed", async () => {
    expect(await sync.reconcile(VIEWER, "Viewer", MODERATOR)).toBe("written");
    expect(db.memberships.has("g-mod viewer")).toBe(true);
    const writes = db.writes.length;

    expect(await sync.reconcile(VIEWER, "viewer", MODERATOR)).toBe("unchanged");
    expect(db.writes).toHaveLength(writes);

    expect(await sync.reconcile(VIEWER, "viewer", NO_ROLES)).toBe("written");
    expect(db.writes.slice(writes)).toEqual([{ op: "remove", groupId: "g-mod", username: "viewer" }]);
  });

  test("memory is per viewer id: another account with the same login state is written on its own", async () => {
    await sync.reconcile(VIEWER, "viewer", MODERATOR);
    const writes = db.writes.length;
    await sync.reconcile(viewerKey("twitch", "v-2"), "other", MODERATOR);
    expect(db.writes.length).toBeGreaterThan(writes);
  });

  test("the remembered viewers are bounded; a forgotten one is rewritten on their next line", async () => {
    await sync.reconcile(viewerKey("twitch", "v-1"), "a", MODERATOR);
    await sync.reconcile(viewerKey("twitch", "v-2"), "b", MODERATOR);
    await sync.reconcile(viewerKey("twitch", "v-3"), "c", MODERATOR);
    expect(sync.remembered).toBe(2);
    expect(await sync.reconcile(viewerKey("twitch", "v-1"), "a", MODERATOR)).toBe("written");
  });

  test("the group catalog is read again after its TTL", async () => {
    await sync.reconcile(viewerKey("twitch", "v-1"), "a", MODERATOR);
    await sync.reconcile(viewerKey("twitch", "v-2"), "b", MODERATOR);
    expect(db.groupListings).toBe(1);
    await time.advance(300_000);
    await sync.reconcile(viewerKey("twitch", "v-3"), "c", MODERATOR);
    expect(db.groupListings).toBe(2);
  });

  test("a failed write forgets the viewer, so the next line retries", async () => {
    db.failWrites = true;
    expect(await sync.reconcile(VIEWER, "viewer", MODERATOR)).toBe("failed");
    db.failWrites = false;
    expect(await sync.reconcile(VIEWER, "viewer", MODERATOR)).toBe("written");
    expect(db.memberships.has("g-mod viewer")).toBe(true);
  });

  test("a group missing from the catalog is recorded and not retried", async () => {
    await sync.reconcile(VIEWER, "viewer", { ...NO_ROLES, isFollower: true });
    expect(db.writes.some((write) => write.groupId === "follower")).toBe(false);
    expect(await sync.reconcile(VIEWER, "viewer", { ...NO_ROLES, isFollower: true })).toBe("unchanged");
  });
});
