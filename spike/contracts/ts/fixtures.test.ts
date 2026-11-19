import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lenient, strict, type Validator } from "./validators";

const fixtures = resolve(import.meta.dirname, "../../../shared/common/contracts/testdata/platform-gateway");

interface Case { name: string; invalidField: string | null; [k: string]: unknown }

const KNOWN_GAPS = new Set([
  "requests.json: an empty ids list on an all target counts as absent",
  "requests.json: a null origin on a platforms target counts as absent",
  "capabilities-replies.json: a platform listed twice",
  "field-options-requests.json: an unknown key is ignored",
]);

const suites: Array<{ file: string; key: string; validator: Validator }> = [
  { file: "requests.json", key: "request", validator: strict("platform-gateway/gateway-request.json") },
  { file: "replies.json", key: "reply", validator: lenient("platform-gateway/gateway-reply.json") },
  { file: "capabilities-replies.json", key: "reply", validator: lenient("platform-gateway/capabilities-reply.json") },
  { file: "field-options-requests.json", key: "request", validator: strict("platform-gateway/field-options-request.json") },
  { file: "field-options-replies.json", key: "reply", validator: lenient("platform-gateway/field-options-reply.json") },
];

for (const { file, key, validator } of suites) {
  const cases = (JSON.parse(readFileSync(resolve(fixtures, file), "utf8")) as { cases: Case[] }).cases;
  describe(file, () => {
    for (const c of cases) {
      const valid = c.invalidField === null;
      test(`${valid ? "accepts" : "refuses"} ${c.name}`, () => {
        const result = validator(c[key]);
        // A case in KNOWN_GAPS pins the disagreement, so closing a gap makes the test fail until the entry is removed.
        expect(result.ok).toBe(KNOWN_GAPS.has(`${file}: ${c.name}`) ? !valid : valid);
      });
    }
  });
}
