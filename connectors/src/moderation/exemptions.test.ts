import { describe, expect, test } from "bun:test";
import { DEFAULT_EXEMPTIONS, type Exemptions, type RuleExemptions } from "@woofx3/api/moderation-config";
import type { ChatterMembership } from "@woofx3/common/cloudevents/Chat/events";
import { isExempt, isProtectedFromPunishment } from "./exemptions";
import { NOBODY } from "./testing";

const broadcaster: ChatterMembership = { ...NOBODY, isBroadcaster: true };
const moderator: ChatterMembership = { ...NOBODY, isModerator: true };
const vip: ChatterMembership = { ...NOBODY, isVip: true };
const subscriber: ChatterMembership = { ...NOBODY, isSubscriber: true };
const noneExempt: Exemptions = { ...DEFAULT_EXEMPTIONS, moderators: false, vips: false, subscribers: false };

describe("isExempt", () => {
  const rows: Array<{
    name: string;
    membership: ChatterMembership | undefined;
    exempt: Exemptions;
    override?: RuleExemptions;
    login?: string;
    expected: boolean;
  }> = [
    { name: "the broadcaster, with nothing else exempt", membership: broadcaster, exempt: noneExempt, expected: true },
    {
      name: "the broadcaster, with a rule exempting no one",
      membership: broadcaster,
      exempt: noneExempt,
      override: { moderators: false, vips: false, subscribers: false, allowLogins: [] },
      expected: true,
    },
    { name: "a moderator by default", membership: moderator, exempt: DEFAULT_EXEMPTIONS, expected: true },
    { name: "a moderator when moderators are not exempt", membership: moderator, exempt: noneExempt, expected: false },
    {
      name: "a moderator when the rule stops exempting moderators",
      membership: moderator,
      exempt: DEFAULT_EXEMPTIONS,
      override: { moderators: false },
      expected: false,
    },
    { name: "a VIP by default", membership: vip, exempt: DEFAULT_EXEMPTIONS, expected: true },
    { name: "a VIP when VIPs are not exempt", membership: vip, exempt: noneExempt, expected: false },
    {
      name: "a VIP when the rule exempts VIPs",
      membership: vip,
      exempt: noneExempt,
      override: { vips: true },
      expected: true,
    },
    { name: "a subscriber by default", membership: subscriber, exempt: DEFAULT_EXEMPTIONS, expected: true },
    {
      name: "a subscriber when subscribers are not exempt",
      membership: subscriber,
      exempt: noneExempt,
      expected: false,
    },
    { name: "an ordinary viewer", membership: NOBODY, exempt: DEFAULT_EXEMPTIONS, expected: false },
    {
      name: "unknown membership is not guessed exempt",
      membership: undefined,
      exempt: DEFAULT_EXEMPTIONS,
      expected: false,
    },
    {
      name: "an allowed login, membership unknown",
      membership: undefined,
      exempt: { ...noneExempt, allowLogins: ["viewer_one"] },
      login: "viewer_one",
      expected: true,
    },
    {
      name: "a rule's allowed logins replace the config's",
      membership: NOBODY,
      exempt: { ...noneExempt, allowLogins: ["viewer_one"] },
      override: { allowLogins: [] },
      login: "viewer_one",
      expected: false,
    },
  ];
  for (const row of rows) {
    test(row.name, () => {
      expect(isExempt(row.membership, row.login ?? "someone", row.exempt, row.override)).toBe(row.expected);
    });
  }
});

describe("isProtectedFromPunishment", () => {
  const rows: Array<[name: string, membership: ChatterMembership | undefined, expected: boolean]> = [
    ["the broadcaster", broadcaster, true],
    ["a moderator", moderator, true],
    ["a VIP", vip, true],
    ["unknown membership", undefined, true],
    ["a subscriber", subscriber, false],
    ["an ordinary viewer", NOBODY, false],
  ];
  for (const [name, membership, expected] of rows) {
    test(name, () => {
      expect(isProtectedFromPunishment(membership)).toBe(expected);
    });
  }
});
