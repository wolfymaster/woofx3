import { describe, expect, it } from "bun:test";
import { type SecretProblemKind, validateSecret } from "./secret";

describe("validateSecret", () => {
  const cases: Array<[string, string, SecretProblemKind | null]> = [
    ["empty", "", "empty"],
    ["whitespace only", " \t\n", "empty"],
    ["CHANGE_ME", "CHANGE_ME", "placeholder"],
    ["changeme", "changeme", "placeholder"],
    ["change-me", "Change-Me", "placeholder"],
    ["padded placeholder", "  secret  ", "placeholder"],
    ["password", "PASSWORD", "placeholder"],
    ["placeholder", "placeholder", "placeholder"],
    ["todo", "TODO", "placeholder"],
    ["xxx", "xxx", "placeholder"],
    ["test", "test", "placeholder"],
    ["31 bytes", "a".repeat(31), "tooShort"],
    ["31 bytes once trimmed", ` ${"a".repeat(31)} `, "tooShort"],
    ["32 bytes", "a".repeat(32), null],
    ["64 hex", "0123456789abcdef".repeat(4), null],
    ["multibyte counts bytes", "é".repeat(16), null],
    ["leading byte order mark is kept", `\uFEFF${"a".repeat(29)}`, null],
    ["next line is trimmed", `\u0085${"a".repeat(31)}`, "tooShort"],
  ];

  for (const [label, value, want] of cases) {
    it(label, () => {
      const result = validateSecret("barkloaderKey", value);
      if (want === null) {
        expect(result).toEqual({ ok: true, value });
        return;
      }
      if (result.ok) {
        throw new Error(`accepted ${label}`);
      }
      expect(result.error.kind).toBe(want);
      expect(result.error.message).toContain("barkloaderKey (WOOFX3_BARKLOADER_KEY)");
      const trimmed = value.trim();
      if (trimmed !== "") {
        expect(result.error.message).not.toContain(trimmed);
      }
    });
  }
});
