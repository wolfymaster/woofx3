import { describe, expect, test } from "bun:test";
import type { PlatformId } from "@woofx3/api/platform-gateway";
import { RecordingLogger } from "../host/testing";
import type { LinkPermits } from "../moderation/permit-store";
import { builtinCommands, formatStreamPosition, VANISH_MAX_SECONDS } from "./builtins";
import { type CommandDefinition, type CommandInvocation, CommandTable } from "./commands";
import { BROADCASTER, chatLine, FakeDispatcherDb, MODERATOR } from "./testing";
import type { ChatLine } from "./trust";
import type { TwitchApiFailure, TwitchApiPort, TwitchApiResult } from "./twitchapi-client";

class FakeTwitchApi implements TwitchApiPort {
  readonly calls: Array<{ command: string; args: unknown }> = [];
  answer: TwitchApiResult<unknown> = { ok: true, value: null };

  async timeout(args: unknown) {
    this.calls.push({ command: "timeout", args });
    return this.answer as TwitchApiResult<null>;
  }
  async updateStream(args: unknown) {
    this.calls.push({ command: "updateStream", args });
    return this.answer as TwitchApiResult<{ title?: string; categoryName?: string }>;
  }
  async createMarker(args: unknown) {
    this.calls.push({ command: "createMarker", args });
    return this.answer as TwitchApiResult<{ positionSeconds: number }>;
  }
}

/** Permits that last `seconds`, or none when null, recording who got one. */
class FakePermits implements LinkPermits {
  readonly granted: Array<{ platform: string; login: string }> = [];
  seconds: number | null = 60;

  permit(platform: PlatformId, login: string): number | null {
    if (this.seconds !== null) {
      this.granted.push({ platform, login });
    }
    return this.seconds;
  }
}

function setup(randomValue = 0) {
  const db = new FakeDispatcherDb();
  const twitchApi = new FakeTwitchApi();
  const permits = new FakePermits();
  const logger = new RecordingLogger();
  const commands = builtinCommands({ db, twitchApi, permits, random: { next: () => randomValue }, logger });
  const byName = (name: string): CommandDefinition => {
    const found = commands.find((command) => command.name === name);
    if (found === undefined) {
      throw new Error(`no built-in ${name}`);
    }
    return found;
  };
  const run = (name: string, line: ChatLine, argsText: string): Promise<string> => {
    const args = argsText === "" ? [] : argsText.split(/\s+/);
    const invocation = {
      line,
      commandName: name,
      text: argsText,
      args,
      variables: {},
      event: {} as CommandInvocation["event"],
    };
    return byName(name).handler(invocation);
  };
  return { db, twitchApi, permits, logger, commands, byName, run };
}

const refused: TwitchApiFailure = { kind: "refused", message: "needs scope", code: "missing_scope" };

describe("built-in commands", () => {
  test("register on a command table without a duplicate", () => {
    const { commands } = setup();
    const table = new CommandTable(commands, { now: () => 0 });
    expect(commands.map((command) => command.name)).toEqual([
      "grantcommands",
      "revokecommands",
      "vanish",
      "permit",
      "category",
      "title",
      "marker",
    ]);
    expect(table.isBuiltin("title")).toBe(true);
  });

  test("the Twitch commands never match on another platform", () => {
    const { commands } = setup();
    const table = new CommandTable(commands, { now: () => 0 });
    const kick = "kick" as never;
    for (const name of ["vanish", "category", "title", "marker"]) {
      expect(table.match(`!${name} x`, "twitch")?.definition.name).toBe(name);
      expect(table.match(`!${name} x`, kick)).toBeNull();
    }
  });

  test("the grant commands run on every platform", () => {
    const { commands } = setup();
    const table = new CommandTable(commands, { now: () => 0 });
    const kick = "kick" as never;
    expect(table.match("!grantcommands bob", kick)?.definition.name).toBe("grantcommands");
    expect(table.match("!revokecommands bob", kick)?.definition.name).toBe("revokecommands");
  });

  test("only the channel editors skip the grant, and only for the channel commands", () => {
    const { byName } = setup();
    for (const name of ["category", "title", "marker"]) {
      expect(byName(name).allowRoles).toEqual(["broadcaster", "moderator"]);
    }
    for (const name of ["grantcommands", "revokecommands", "vanish"]) {
      expect(byName(name).allowRoles).toEqual([]);
      expect(byName(name).visibility).toBe("restricted");
    }
  });

  describe("grantcommands and revokecommands", () => {
    test("grant the moderator role on every command to a login", async () => {
      const { db, run } = setup();
      expect(await run("grantcommands", chatLine(), "@Some_Mod")).toBe("");
      expect([...db.resourceRoles]).toEqual(["some_mod command/* moderator"]);
    });

    test("revoke it again", async () => {
      const { db, run } = setup();
      db.resourceRoles.add("some_mod command/* moderator");
      expect(await run("revokecommands", chatLine(), "some_mod")).toBe("");
      expect(db.resourceRoles.size).toBe(0);
    });

    const invalid = ["", "two words", "bad-login", "has.dot", "a".repeat(26), "@", "ünï"];
    test.each(invalid)("refuse the login %p with a usage line and change nothing", async (login) => {
      const { db, run } = setup();
      expect(await run("grantcommands", chatLine(), login)).toBe("Usage: !grantcommands <login>");
      expect(await run("revokecommands", chatLine(), login)).toBe("Usage: !revokecommands <login>");
      expect(db.resourceRoles.size).toBe(0);
    });

    test("accept a 25 character login", async () => {
      const { db, run } = setup();
      await run("grantcommands", chatLine(), "a".repeat(25));
      expect(db.resourceRoles.size).toBe(1);
    });

    test("tell the chatter when db-proxy fails", async () => {
      const { db, logger, run } = setup();
      db.failWrites = true;
      expect(await run("grantcommands", chatLine(), "bob")).toBe("Could not grant commands to @bob");
      expect(logger.at("error")).toHaveLength(1);
    });

    test("do nothing for a line that is not from the platform", async () => {
      const { db, logger, run } = setup();
      expect(await run("grantcommands", chatLine({ trusted: false }), "bob")).toBe("");
      expect(db.resourceRoles.size).toBe(0);
      expect(logger.at("warn")).toHaveLength(1);
    });
  });

  describe("vanish", () => {
    test("times the speaker out by id for a seeded duration", async () => {
      const { twitchApi, run } = setup(0.5);
      const reply = await run("vanish", chatLine({ platformUserId: "42", chatterName: "Pat" }), "");
      expect(reply).toBe("*poof* @Pat is gone");
      expect(twitchApi.calls).toEqual([
        { command: "timeout", args: { userId: "42", durationSeconds: 1 + Math.floor(0.5 * VANISH_MAX_SECONDS) } },
      ]);
    });

    test.each([
      [0, 1],
      [0.999999, VANISH_MAX_SECONDS],
    ])("draws a duration from 1 to %p of the maximum", async (random, expected) => {
      const { twitchApi, run } = setup(random);
      await run("vanish", chatLine(), "");
      expect(twitchApi.calls[0].args).toMatchObject({ durationSeconds: expected });
    });

    test.each([
      ["broadcaster", BROADCASTER],
      ["moderator", MODERATOR],
    ])("spares a %s", async (_role, membership) => {
      const { twitchApi, run } = setup();
      expect(await run("vanish", chatLine({ chatterName: "Boss", membership }), "")).toBe(
        "@Boss is too important to vanish"
      );
      expect(twitchApi.calls).toEqual([]);
    });

    test("reports a Twitch failure", async () => {
      const { twitchApi, run } = setup();
      twitchApi.answer = { ok: false, failure: refused };
      expect(await run("vanish", chatLine({ chatterName: "Pat" }), "")).toBe("Could not make @Pat vanish: needs scope");
    });

    test("says Twitch is unavailable when the integration is off", async () => {
      const { twitchApi, run } = setup();
      twitchApi.answer = {
        ok: false,
        failure: { kind: "refused", message: "off", code: "integration_unavailable" },
      };
      expect(await run("vanish", chatLine({ chatterName: "Pat" }), "")).toBe(
        "Twitch is not available right now, so I could not make @Pat vanish"
      );
    });

    test("is not run for a simulated line", async () => {
      const { twitchApi, run } = setup();
      expect(await run("vanish", chatLine({ trusted: false }), "")).toBe("");
      expect(twitchApi.calls).toEqual([]);
    });
  });

  describe("category, title and marker", () => {
    test("category sets the category and echoes the resolved name", async () => {
      const { twitchApi, run } = setup();
      twitchApi.answer = { ok: true, value: { categoryName: "Just Chatting" } };
      expect(await run("category", chatLine(), "just chatting")).toBe("Stream category set to Just Chatting");
      expect(twitchApi.calls).toEqual([{ command: "updateStream", args: { category: "just chatting" } }]);
    });

    test("title sets the title", async () => {
      const { twitchApi, run } = setup();
      twitchApi.answer = { ok: true, value: {} };
      expect(await run("title", chatLine(), "new title")).toBe("Stream title updated to: new title");
      expect(twitchApi.calls).toEqual([{ command: "updateStream", args: { title: "new title" } }]);
    });

    test.each([
      ["category", "Usage: !category <category name>"],
      ["title", "Usage: !title <new stream title>"],
    ])("%s without text gives usage and asks Twitch nothing", async (name, usage) => {
      const { twitchApi, run } = setup();
      expect(await run(name, chatLine(), "")).toBe(usage);
      expect(twitchApi.calls).toEqual([]);
    });

    test("marker places a marker with or without a description", async () => {
      const { twitchApi, run } = setup();
      twitchApi.answer = { ok: true, value: { positionSeconds: 3725 } };
      expect(await run("marker", chatLine(), "")).toBe("Stream marker placed at 1:02:05");
      await run("marker", chatLine(), "big play");
      expect(twitchApi.calls.map((call) => call.args)).toEqual([
        { description: undefined },
        { description: "big play" },
      ]);
    });

    test.each([
      ["category", "change the category", "x"],
      ["title", "change the title", "x"],
      ["marker", "place a marker", ""],
    ])("%s reports a timeout as unknown", async (name, action, argsText) => {
      const { twitchApi, run } = setup();
      twitchApi.answer = { ok: false, failure: { kind: "no_answer" } };
      expect(await run(name, chatLine(), argsText)).toBe(
        `No answer from Twitch yet, so it is unknown whether I could ${action}; it may still apply`
      );
    });

    test.each(["category", "title", "marker"])("%s is not run for a simulated line", async (name) => {
      const { twitchApi, run } = setup();
      expect(await run(name, chatLine({ trusted: false }), "x")).toBe("");
      expect(twitchApi.calls).toEqual([]);
    });
  });

  test("formatStreamPosition pads minutes and seconds", () => {
    expect(formatStreamPosition(0)).toBe("0:00:00");
    expect(formatStreamPosition(59.9)).toBe("0:00:59");
    expect(formatStreamPosition(3600)).toBe("1:00:00");
  });
});

describe("!permit", () => {
  test("lets a named viewer post a link for the configured time, ignoring @ and case", async () => {
    const { permits, run } = setup();
    expect(await run("permit", chatLine({ membership: MODERATOR }), "@Some_Viewer")).toBe(
      "@some_viewer may post a link for the next 60 seconds"
    );
    expect(permits.granted).toEqual([{ platform: "twitch", login: "some_viewer" }]);
  });

  test("may be run by the broadcaster and moderators only", () => {
    const { byName } = setup();
    expect(byName("permit").allowRoles).toEqual(["broadcaster", "moderator"]);
  });

  test("says so when links are not being filtered", async () => {
    const { permits, run } = setup();
    permits.seconds = null;
    expect(await run("permit", chatLine({ membership: BROADCASTER }), "someone")).toBe(
      "Links are not being filtered right now"
    );
  });

  const usage: Array<[name: string, args: string]> = [
    ["no login", ""],
    ["two logins", "one two"],
    ["a login with symbols", "not-a-login!"],
  ];
  for (const [name, args] of usage) {
    test(`answers with its usage for ${name}`, async () => {
      const { permits, run } = setup();
      expect(await run("permit", chatLine({ membership: MODERATOR }), args)).toBe("Usage: !permit <login>");
      expect(permits.granted).toHaveLength(0);
    });
  }

  test("ignores a permit for oneself", async () => {
    const { permits, run } = setup();
    expect(await run("permit", chatLine({ membership: MODERATOR, chatterLogin: "mod_one" }), "mod_one")).toBe("");
    expect(permits.granted).toHaveLength(0);
  });

  test("refuses a line that is not from the platform", async () => {
    const { permits, run } = setup();
    expect(await run("permit", chatLine({ trusted: false, membership: undefined }), "someone")).toBe("");
    expect(permits.granted).toHaveLength(0);
  });
});
