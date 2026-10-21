import { describe, expect, test } from "bun:test";
import { canUse } from "./util";
import type { DatabaseClient } from "./services/database";

describe("canUse", () => {
  test("allows the command when the database grants read permission on command/<cmd>", async () => {
    const db = {
      hasPermission: async () => ({ code: "OK" as const }),
    };

    const result = await canUse("SomeUser", "song", db as unknown as DatabaseClient);
    expect(result.granted).toBe(true);
    expect(result.message).toBe("");
  });

  test("denies the command with feedback when permission is not granted", async () => {
    const db = {
      hasPermission: async () => ({ code: "DENIED" as const }),
    };

    const result = await canUse("intruder", "song", db as unknown as DatabaseClient);
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
    };

    await canUse("  ModName  ", "vanish", db as unknown as DatabaseClient);
    expect(seen?.username).toBe("modname");
    expect(seen?.resource).toBe("command/vanish");
  });
});
