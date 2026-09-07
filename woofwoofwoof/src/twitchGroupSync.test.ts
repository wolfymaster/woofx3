import { describe, expect, it, mock } from "bun:test";
import type { ChatterBadges } from "@woofx3/common/cloudevents/Twitch/events";
import type { DatabaseClient } from "./services/database";
import { TwitchGroupSync } from "./twitchGroupSync";

function badges(overrides: Partial<ChatterBadges> = {}): ChatterBadges {
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
  { id: "g-subscriber", name: "subscriber", isBuiltIn: true },
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
  return new TwitchGroupSync(db, "", fakeLogger());
}

describe("TwitchGroupSync", () => {
  it("adds the groups a chatter's badges grant and removes the rest", async () => {
    const { db, added, removed } = fakeDb();

    await newSync(db).reconcile("TrustedMod", badges({ isModerator: true, isSubscriber: true }));

    expect(added.map((a) => a.groupId).sort()).toEqual(["g-moderator", "g-subscriber"]);
    expect(removed.map((r) => r.groupId).sort()).toEqual(["g-broadcaster", "g-vip"]);
  });

  it("normalizes the username to lowercase", async () => {
    const { db, added } = fakeDb();

    await newSync(db).reconcile("  TrustedMod  ", badges({ isModerator: true }));

    expect(added[0].username).toBe("trustedmod");
  });

  // Badges arrive on every single chat message; writing membership each time
  // would mean several db round trips per chat line.
  it("does not write again when the badge set is unchanged", async () => {
    const { db, added, removed, raw } = fakeDb();
    const sync = newSync(db);

    await sync.reconcile("trustedmod", badges({ isModerator: true }));
    const writesAfterFirst = added.length + removed.length;

    await sync.reconcile("trustedmod", badges({ isModerator: true }));
    await sync.reconcile("trustedmod", badges({ isModerator: true }));

    expect(added.length + removed.length).toBe(writesAfterFirst);
    // The group catalog is resolved once, not per message.
    expect(raw.listGroups).toHaveBeenCalledTimes(1);
  });

  it("writes only the groups that actually changed", async () => {
    const { db, added, removed } = fakeDb();
    const sync = newSync(db);

    await sync.reconcile("chatter", badges({ isSubscriber: true }));
    added.length = 0;
    removed.length = 0;

    // Gains VIP, keeps the subscription.
    await sync.reconcile("chatter", badges({ isSubscriber: true, isVip: true }));

    expect(added).toEqual([{ groupId: "g-vip", username: "chatter" }]);
    expect(removed).toEqual([]);
  });

  it("removes membership when a badge goes away", async () => {
    const { db, added, removed } = fakeDb();
    const sync = newSync(db);

    await sync.reconcile("chatter", badges({ isSubscriber: true }));
    added.length = 0;
    removed.length = 0;

    await sync.reconcile("chatter", badges({ isSubscriber: false }));

    expect(removed).toEqual([{ groupId: "g-subscriber", username: "chatter" }]);
  });

  it("never syncs the everyone group, which has no membership rows", async () => {
    const { db, added, removed } = fakeDb();

    await newSync(db).reconcile("chatter", badges({ isBroadcaster: true }));

    const touched = [...added, ...removed].map((x) => x.groupId);
    expect(touched).not.toContain("g-everyone");
  });

  it("ignores non-built-in groups that happen to share a name", async () => {
    const { db, added, removed } = fakeDb();

    await newSync(db).reconcile("chatter", badges({ isModerator: true }));

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

    await sync.reconcile("chatter", badges({ isModerator: true }));
    await sync.reconcile("chatter", badges({ isModerator: true }));

    expect(raw.addUserToGroup).toHaveBeenCalledTimes(2);
  });
});
