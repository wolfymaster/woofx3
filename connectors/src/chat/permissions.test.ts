import { beforeEach, describe, expect, test } from "bun:test";
import { FakeTime } from "../host/testing";
import type { CommandDefinition } from "./commands";
import { CommandPermissions, commandResource } from "./permissions";
import { BROADCASTER, chatLine, FakeDispatcherDb, MODERATOR } from "./testing";

const restricted: CommandDefinition = {
  name: "title",
  handler: async () => "",
  visibility: "restricted",
  cooldownSeconds: 0,
  variables: [],
  allowRoles: ["broadcaster", "moderator"],
};

describe("CommandPermissions", () => {
  let db: FakeDispatcherDb;
  let time: FakeTime;
  let permissions: CommandPermissions;

  beforeEach(() => {
    db = new FakeDispatcherDb();
    time = new FakeTime();
    permissions = new CommandPermissions(db, { capacity: 2, ttlMs: 5_000 }, time);
  });

  test("a public command needs no check", async () => {
    expect(await permissions.authorize({ ...restricted, visibility: "public" }, "title", chatLine())).toBe("granted");
    expect(db.permissionChecks).toEqual([]);
  });

  test("a role the platform reported passes allowRoles without a check", async () => {
    expect(await permissions.authorize(restricted, "title", chatLine({ membership: MODERATOR }))).toBe("granted");
    expect(db.permissionChecks).toEqual([]);
  });

  test("simulated badges cannot escalate: an untrusted line goes to the permission check", async () => {
    const line = chatLine({ trusted: false, membership: undefined, chatterLogin: "faker" });
    expect(await permissions.authorize(restricted, "title", line)).toBe("denied");
    expect(db.permissionChecks).toEqual([{ username: "faker", resource: "command/title" }]);
  });

  test("a grant is read by the speaker's login", async () => {
    db.grants.add(`wolfy ${commandResource("title")}`);
    const line = chatLine({ chatterLogin: "wolfy", chatterName: "Wolfy_The_Great", membership: BROADCASTER });
    expect(await permissions.authorize({ ...restricted, allowRoles: [] }, "title", line)).toBe("granted");
  });

  test("two accounts with one display name never share a cached decision", async () => {
    const command = { ...restricted, allowRoles: [] };
    db.grants.add(`wolf ${commandResource("title")}`);
    const real = chatLine({ platformUserId: "v-1", chatterLogin: "wolf", chatterName: "Wolf" });
    const lookalike = chatLine({ platformUserId: "v-2", chatterLogin: "wolf_", chatterName: "Wolf" });

    expect(await permissions.authorize(command, "title", real)).toBe("granted");
    expect(await permissions.authorize(command, "title", lookalike)).toBe("denied");
  });

  const forgeries = [
    {
      name: "a forged denial does not refuse the real viewer",
      forged: { platformUserId: "v-1", chatterLogin: "nobody" },
      forgedDecision: "denied",
      real: { platformUserId: "v-1", chatterLogin: "wolf" },
      realDecision: "granted",
    },
    {
      name: "a forged grant does not admit the real viewer",
      forged: { platformUserId: "v-2", chatterLogin: "wolf" },
      forgedDecision: "granted",
      real: { platformUserId: "v-2", chatterLogin: "pup" },
      realDecision: "denied",
    },
  ] as const;
  for (const { name, forged, forgedDecision, real, realDecision } of forgeries) {
    test(`an untrusted line naming a real viewer's id: ${name}`, async () => {
      const command = { ...restricted, allowRoles: [] };
      db.grants.add(`wolf ${commandResource("title")}`);
      const forgedLine = chatLine({ ...forged, trusted: false, membership: undefined });
      expect(await permissions.authorize(command, "title", forgedLine)).toBe(forgedDecision);
      expect(await permissions.authorize(command, "title", chatLine(real))).toBe(realDecision);
    });
  }

  test("a decision is cached until its TTL", async () => {
    const command = { ...restricted, allowRoles: [] };
    await permissions.authorize(command, "title", chatLine());
    await permissions.authorize(command, "title", chatLine());
    expect(db.permissionChecks).toHaveLength(1);

    await time.advance(5_000);
    await permissions.authorize(command, "title", chatLine());
    expect(db.permissionChecks).toHaveLength(2);
  });

  test("the cache evicts the least recent decision beyond its capacity", async () => {
    const command = { ...restricted, allowRoles: [] };
    for (const id of ["v-1", "v-2", "v-3"]) {
      await permissions.authorize(command, "title", chatLine({ platformUserId: id }));
    }
    expect(permissions.cached).toBe(2);

    await permissions.authorize(command, "title", chatLine({ platformUserId: "v-1" }));
    expect(db.permissionChecks).toHaveLength(4);
  });

  test("a failed check throws and is not cached", async () => {
    const command = { ...restricted, allowRoles: [] };
    db.failPermission = true;
    await expect(permissions.authorize(command, "title", chatLine())).rejects.toThrow("HasPermission");
    db.failPermission = false;
    expect(await permissions.authorize(command, "title", chatLine())).toBe("denied");
    expect(db.permissionChecks).toHaveLength(2);
  });
});
