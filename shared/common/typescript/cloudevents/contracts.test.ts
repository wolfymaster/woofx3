// Runs the shared fixtures in shared/contracts/<source>/fixtures through the generated Ajv validators, for every
// message TypeScript consumes. The Go and Rust tests run the same files for the messages they consume, and
// scripts/contracts/fixtures.ts checks every fixture against the contract document, so a case fixes the verdict
// of every language.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as validators from "./messages.validate.gen";

type Validator = ((value: unknown) => boolean) & { errors?: unknown };

const contractsDir = join(import.meta.dir, "..", "..", "..", "contracts");
const validatorOf = (schema: string): Validator | undefined =>
  (validators as Record<string, Validator | undefined>)[`validate${schema}`];

interface Fixture {
  schema: string;
  cases: { name: string; valid: boolean; value: unknown }[];
}

for (const source of readdirSync(contractsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
  const fixturesDir = join(contractsDir, source.name, "fixtures");
  let files: string[] = [];
  try {
    files = readdirSync(fixturesDir).filter((name) => name.endsWith(".json"));
  } catch {
    continue;
  }
  for (const file of files) {
    const fixture: Fixture = JSON.parse(readFileSync(join(fixturesDir, file), "utf8"));
    const validate = validatorOf(fixture.schema);
    if (!validate) {
      continue;
    }
    describe(`${source.name}/${file}`, () => {
      for (const c of fixture.cases) {
        test(c.name, () => {
          expect(validate(c.value)).toBe(c.valid);
        });
      }
    });
  }
}
