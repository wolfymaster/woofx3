import { describe, expect, test } from "bun:test";
import {
  DEFAULT_FILTER_PARAMS,
  DEFAULT_MODERATION_CONFIG,
  FILTER_IDS,
  type ModerationConfig,
  type ModerationParseResult,
  parseModerationConfig,
} from "../moderation-config";

function errorOf(result: ModerationParseResult<unknown>): string {
  return result.ok ? "" : result.error;
}

const FULL: ModerationConfig = {
  version: 1,
  enabled: true,
  dryRun: true,
  exempt: { broadcaster: true, moderators: true, vips: false, subscribers: true, allowLogins: ["friend_bot"] },
  rules: {
    links: {
      enabled: true,
      actions: [{ kind: "delete" }, { kind: "warn", reason: "No links, please." }],
      exempt: { subscribers: false },
      params: { allowDomains: ["example.tv"], permitSeconds: 60 },
    },
    caps: { enabled: false, actions: [{ kind: "timeout", durationSeconds: 60 }], params: DEFAULT_FILTER_PARAMS.caps },
    banned_phrases: {
      enabled: true,
      actions: [{ kind: "delete" }, { kind: "ban" }],
      params: { phrases: [{ pattern: "bad*word", wholeWord: true }] },
    },
  },
};

const REMOVED = Symbol("removed");

/** FULL with the value at `path` replaced, or removed. */
function edited(path: string, value: unknown): unknown {
  const copy: Record<string, unknown> = structuredClone(FULL) as unknown as Record<string, unknown>;
  const keys = path.split(".");
  const last = keys.pop() as string;
  let node = copy;
  for (const key of keys) {
    node = node[key] as Record<string, unknown>;
  }
  if (value === REMOVED) {
    delete node[last];
  } else {
    node[last] = value;
  }
  return copy;
}

describe("parseModerationConfig", () => {
  test("round-trips a full config", () => {
    expect(parseModerationConfig(structuredClone(FULL))).toEqual({ ok: true, value: FULL });
    expect(parseModerationConfig(JSON.parse(JSON.stringify(FULL)))).toEqual({ ok: true, value: FULL });
  });

  test("round-trips the default config, which is off", () => {
    expect(parseModerationConfig(DEFAULT_MODERATION_CONFIG)).toEqual({ ok: true, value: DEFAULT_MODERATION_CONFIG });
    expect(DEFAULT_MODERATION_CONFIG.enabled).toBe(false);
  });

  test("accepts every filter's default params", () => {
    const rules = Object.fromEntries(
      FILTER_IDS.map((id) => [id, { enabled: true, actions: [{ kind: "delete" }], params: DEFAULT_FILTER_PARAMS[id] }])
    );
    expect(parseModerationConfig({ ...DEFAULT_MODERATION_CONFIG, rules }).ok).toBe(true);
  });

  test("puts actions in the order they run and normalises names and reasons", () => {
    const parsed = parseModerationConfig(
      edited("rules.links.actions", [{ kind: "warn", reason: "  no links  " }, { kind: "delete" }])
    );
    expect(parsed.ok && parsed.value.rules.links?.actions).toEqual([
      { kind: "delete" },
      { kind: "warn", reason: "no links" },
    ]);
    const logins = parseModerationConfig(edited("exempt.allowLogins", ["@Friend_Bot", "friend_bot"]));
    expect(logins.ok && logins.value.exempt.allowLogins).toEqual(["friend_bot"]);
  });

  const invalid: Array<[name: string, raw: unknown, error: string]> = [
    ["not an object", "config", "must be an object"],
    ["an unknown version", edited("version", 2), "version 2 is not one this engine reads"],
    ["no version", edited("version", REMOVED), "version undefined"],
    ["an unknown field", edited("extra", 1), 'unknown field "extra"'],
    ["no dryRun", edited("dryRun", REMOVED), "dryRun is required"],
    ["enabled as text", edited("enabled", "yes"), "enabled must be true or false"],
    ["the broadcaster not exempt", edited("exempt.broadcaster", false), "exempt.broadcaster is always true"],
    ["a role flag missing", edited("exempt.vips", REMOVED), "exempt: vips is required"],
    ["a login with a space", edited("exempt.allowLogins", ["two words"]), "exempt.allowLogins[0]"],
    ["an unknown filter", edited("rules.colours", FULL.rules.caps), '"colours" is not a filter'],
    ["no actions", edited("rules.links.actions", []), "rules.links.actions must list at least one"],
    ["an unknown action", edited("rules.links.actions", [{ kind: "kick" }]), "kind must be one of"],
    ["an action twice", edited("rules.links.actions", [{ kind: "delete" }, { kind: "delete" }]), "lists delete twice"],
    [
      "timeout and ban together",
      edited("rules.links.actions", [{ kind: "timeout", durationSeconds: 60 }, { kind: "ban" }]),
      "may time out or ban, not both",
    ],
    ["a warning without a reason", edited("rules.links.actions", [{ kind: "warn" }]), "reason is required"],
    [
      "a blank warning reason",
      edited("rules.links.actions", [{ kind: "warn", reason: "   " }]),
      "a warning needs a reason",
    ],
    [
      "a warning reason over its limit",
      edited("rules.links.actions", [{ kind: "warn", reason: "a".repeat(201) }]),
      "at most 200 characters",
    ],
    [
      "a warning reason that reads as a command",
      edited("rules.links.actions", [{ kind: "warn", reason: "/ban everyone" }]),
      'must not start with "/"',
    ],
    [
      "a timeout of zero",
      edited("rules.links.actions", [{ kind: "timeout", durationSeconds: 0 }]),
      "durationSeconds must be a whole number from 1",
    ],
    [
      "a timeout over two weeks",
      edited("rules.links.actions", [{ kind: "timeout", durationSeconds: 1_209_601 }]),
      "durationSeconds must be a whole number from 1 to 1209600",
    ],
    ["a stray field on delete", edited("rules.links.actions", [{ kind: "delete", x: 1 }]), 'unknown field "x"'],
    ["bad filter params", edited("rules.caps.params", { minLength: 0, maxPercent: 50 }), "rules.caps.params"],
    [
      "a rule exemption for the broadcaster",
      edited("rules.links.exempt", { broadcaster: false }),
      'rules.links.exempt: unknown field "broadcaster"',
    ],
    [
      "too many phrases",
      edited("rules.banned_phrases.params", {
        phrases: Array.from({ length: 201 }, (_, i) => ({ pattern: `word${i}`, wholeWord: false })),
      }),
      "at most 200",
    ],
    [
      "phrases over the total length",
      edited("rules.banned_phrases.params", {
        phrases: Array.from({ length: 41 }, (_, i) => ({ pattern: `${i}`.padEnd(100, "x"), wholeWord: false })),
      }),
      "more than 4000 characters",
    ],
  ];
  for (const [name, raw, error] of invalid) {
    test(`refuses ${name}`, () => {
      expect(errorOf(parseModerationConfig(raw))).toContain(error);
    });
  }
});
