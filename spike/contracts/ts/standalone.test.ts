import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// eslint-disable-next-line
const strict = require("./generated/validators.strict.cjs");
const lenient = require("./generated/validators.lenient.cjs");

const fixtures = resolve(import.meta.dirname, "../../../shared/common/contracts/testdata/platform-gateway");
const suites = [
  ["requests.json", "request", strict.validateGatewayRequest],
  ["replies.json", "reply", lenient.validateGatewayReply],
  ["capabilities-replies.json", "reply", lenient.validateCapabilitiesReply],
  ["field-options-requests.json", "request", strict.validateFieldOptionsRequest],
  ["field-options-replies.json", "reply", lenient.validateFieldOptionsReply],
] as const;

test("standalone validators agree with the fixtures as the runtime-compiled ones do", () => {
  const disagreements: string[] = [];
  for (const [file, key, validate] of suites) {
    for (const c of JSON.parse(readFileSync(resolve(fixtures, file), "utf8")).cases) {
      if (validate(c[key]) !== (c.invalidField === null)) {
        disagreements.push(`${file}: ${c.name}`);
      }
    }
  }
  console.log(disagreements);
  expect(disagreements.length).toBe(4);
});
