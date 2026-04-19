import { describe, expect, test } from "bun:test";
import { canUse, parseTime } from "./util";
import type { DatabaseClient } from "./services/database";

describe("parseTime", () => {
  test("converts mixed minute and second tokens to total seconds", () => {
    expect(parseTime("2m 30s")).toBe(150);
    expect(parseTime("1m")).toBe(60);
    expect(parseTime("45s")).toBe(45);
  });

  test("sums multiple segments of the same unit", () => {
    expect(parseTime("1m 2m")).toBe(180);
    expect(parseTime("10s 5s")).toBe(15);
  });

  test("returns zero when no duration tokens are present", () => {
    expect(parseTime("")).toBe(0);
    expect(parseTime("no numbers here")).toBe(0);
  });
});

describe("canUse", () => {
  test("allows the command when the database grants read permission on command/<cmd>", async () => {
    const db = {
      hasPermission: async () => ({ code: "OK" as const }),
    } satisfies Pick<DatabaseClient, "hasPermission">;

    const result = await canUse("SomeUser", "song", db as DatabaseClient);
    expect(result.granted).toBe(true);
    expect(result.message).toBe("");
  });

  test("denies the command with feedback when permission is not granted", async () => {
    const db = {
      hasPermission: async () => ({ code: "DENIED" as const }),
    } satisfies Pick<DatabaseClient, "hasPermission">;

    const result = await canUse("intruder", "song", db as DatabaseClient);
    expect(result.granted).toBe(false);
    expect(result.message).toContain("intruder");
    expect(result.message).toContain("YOU CAN'T DO THAT");
  });

  test("checks permission using a normalized username and the command name in the resource path", async () => {
    let seen: { username: string; resource: string } | undefined;
    const db = {
      hasPermission: async (req: { username: string; resource: string }) => {
        seen = { username: req.username, resource: req.resource };
        return { code: "OK" as const };
      },
    } satisfies Pick<DatabaseClient, "hasPermission">;

    await canUse("  ModName  ", "vanish", db as DatabaseClient);
    expect(seen?.username).toBe("modname");
    expect(seen?.resource).toBe("command/vanish");
  });
});
