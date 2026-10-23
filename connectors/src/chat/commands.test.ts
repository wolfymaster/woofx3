import { describe, expect, test } from "bun:test";
import { FakeTime } from "../host/testing";
import { BoundedMap } from "./bounded-map";
import { type CommandDefinition, CommandTable, parseCommandCall } from "./commands";

function definition(overrides: Partial<CommandDefinition> = {}): CommandDefinition {
  return {
    name: "hug",
    handler: async () => "",
    visibility: "public",
    cooldownSeconds: 0,
    variables: [],
    allowRoles: [],
    ...overrides,
  };
}

describe("parseCommandCall", () => {
  const cases: Array<{ line: string; call: ReturnType<typeof parseCommandCall> }> = [
    { line: "!hug", call: { name: "hug", text: "" } },
    { line: "  !hug  ", call: { name: "hug", text: "" } },
    { line: "!sr Life is a highway", call: { name: "sr", text: "Life is a highway" } },
    { line: "!sr\tLife   is", call: { name: "sr", text: "Life   is" } },
    { line: "hug", call: null },
    { line: "!", call: null },
    { line: "! hug", call: null },
    { line: "", call: null },
    { line: "hello !hug", call: null },
  ];
  for (const { line, call } of cases) {
    test(JSON.stringify(line), () => {
      expect(parseCommandCall(line)).toEqual(call);
    });
  }
});

describe("CommandTable", () => {
  test("matches a stored command by name, with its args and variables", () => {
    const table = new CommandTable([], new FakeTime());
    table.setStored(definition({ name: "sr", variables: ["songTitle"] }));

    const match = table.match("!sr Life is a highway", "twitch");

    expect(match?.definition.name).toBe("sr");
    expect(match?.args).toEqual(["Life", "is", "a", "highway"]);
    expect(match?.variables).toEqual({ songTitle: "Life is a highway" });
  });

  test("names are matched exactly", () => {
    const table = new CommandTable([], new FakeTime());
    table.setStored(definition());
    expect(table.match("!Hug", "twitch")).toBeNull();
    expect(table.match("!hugs", "twitch")).toBeNull();
  });

  test("a built-in wins over a stored command of the same name", () => {
    const builtin = definition({ name: "title", visibility: "restricted" });
    const table = new CommandTable([builtin], new FakeTime());
    table.setStored(definition({ name: "title" }));
    expect(table.match("!title x", "twitch")?.definition).toBe(builtin);
  });

  test("a command limited to other platforms does not match", () => {
    const table = new CommandTable([definition({ platforms: [] })], new FakeTime());
    expect(table.match("!hug", "twitch")).toBeNull();
  });

  test("a built-in registered twice stops construction", () => {
    expect(() => new CommandTable([definition(), definition()], new FakeTime())).toThrow("registered twice");
  });

  for (const name of ["", "two words", "!hug"]) {
    test(`refuses the command name ${JSON.stringify(name)}`, () => {
      const table = new CommandTable([], new FakeTime());
      expect(() => table.setStored(definition({ name }))).toThrow("one word");
    });
  }

  test("the cooldown is per command and survives the command being replaced", async () => {
    const time = new FakeTime();
    const table = new CommandTable([], time);
    table.setStored(definition({ cooldownSeconds: 10 }));

    expect(table.takeCooldown(definition({ cooldownSeconds: 10 }))).toBe(true);
    table.setStored(definition({ cooldownSeconds: 10, visibility: "restricted" }));
    await time.advance(9_999);
    expect(table.takeCooldown(definition({ cooldownSeconds: 10 }))).toBe(false);
    await time.advance(1);
    expect(table.takeCooldown(definition({ cooldownSeconds: 10 }))).toBe(true);
  });

  test("removing a command forgets its cooldown", () => {
    const table = new CommandTable([], new FakeTime());
    table.setStored(definition({ cooldownSeconds: 10 }));
    expect(table.takeCooldown(definition({ cooldownSeconds: 10 }))).toBe(true);
    table.removeStored("hug");
    expect(table.takeCooldown(definition({ cooldownSeconds: 10 }))).toBe(true);
  });

  test("a command with no cooldown never throttles", () => {
    const table = new CommandTable([], new FakeTime());
    expect(table.takeCooldown(definition())).toBe(true);
    expect(table.takeCooldown(definition())).toBe(true);
  });
});

describe("BoundedMap", () => {
  test("evicts the least recently used entry beyond its capacity", () => {
    const map = new BoundedMap<string, number>({ capacity: 2 }, new FakeTime());
    map.set("a", 1);
    map.set("b", 2);
    map.get("a");
    map.set("c", 3);
    expect(map.get("a")).toBe(1);
    expect(map.get("b")).toBeUndefined();
    expect(map.get("c")).toBe(3);
  });

  test("an entry expires at its TTL", async () => {
    const time = new FakeTime();
    const map = new BoundedMap<string, number>({ capacity: 2, ttlMs: 100 }, time);
    map.set("a", 1);
    await time.advance(99);
    expect(map.get("a")).toBe(1);
    await time.advance(1);
    expect(map.get("a")).toBeUndefined();
    expect(map.size).toBe(0);
  });

  for (const config of [{ capacity: 0 }, { capacity: 1.5 }, { capacity: 1, ttlMs: 0 }]) {
    test(`refuses ${JSON.stringify(config)}`, () => {
      expect(() => new BoundedMap(config, new FakeTime())).toThrow();
    });
  }
});
