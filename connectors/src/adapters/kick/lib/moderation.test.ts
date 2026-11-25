import { describe, expect, test } from "bun:test";
import { kickBan, kickSlugCandidates } from "./moderation";

describe("kickBan", () => {
  const cases: [
    name: string,
    seconds: number | undefined,
    reason: string | undefined,
    result: ReturnType<typeof kickBan>,
  ][] = [
    ["a ban", undefined, undefined, { ok: true, durationMinutes: undefined }],
    ["one second, rounded up to a minute", 1, undefined, { ok: true, durationMinutes: 1 }],
    ["61 seconds, rounded up to two minutes", 61, undefined, { ok: true, durationMinutes: 2 }],
    ["seven days", 604_800, undefined, { ok: true, durationMinutes: 10_080 }],
  ];
  for (const [name, seconds, reason, result] of cases) {
    test(`takes ${name}`, () => {
      expect(kickBan(seconds, reason)).toEqual(result);
    });
  }

  const refused: [name: string, seconds: number | undefined, reason: string | undefined][] = [
    ["zero seconds", 0, undefined],
    ["more than seven days", 604_801, undefined],
    ["a duration that is not a number", Number.NaN, undefined],
    ["a reason over 100 characters", undefined, "x".repeat(101)],
  ];
  for (const [name, seconds, reason] of refused) {
    test(`refuses ${name}`, () => {
      expect(kickBan(seconds, reason).ok).toBe(false);
    });
  }
});

describe("kickSlugCandidates", () => {
  const cases: [typed: string, slugs: string[]][] = [
    ["@Pup_Pal", ["pup_pal", "pup-pal"]],
    ["pup-pal", ["pup-pal"]],
    ["  WOLFY ", ["wolfy"]],
    ["@", []],
  ];
  for (const [typed, slugs] of cases) {
    test(`${JSON.stringify(typed)} may be ${JSON.stringify(slugs)}`, () => {
      expect(kickSlugCandidates(typed)).toEqual(slugs);
    });
  }
});
