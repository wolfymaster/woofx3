// Runs the shared fixtures in shared/contracts/<domain>/fixtures through the generated Ajv validators. The Go and Rust
// tests run the same files, so a case fixes the verdict of all three languages.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as barkloader from "./Barkloader/barkloader.validate.gen";
import * as module from "./Module/module.validate.gen";
import * as outbox from "./Outbox/outbox.validate.gen";
import * as scene from "./Scene/scene.validate.gen";

type Validator = ((value: unknown) => boolean) & { errors?: unknown };

const domains: Record<string, Record<string, Validator>> = { scene, barkloader, module, outbox };
const contractsDir = join(import.meta.dir, "..", "..", "..", "contracts");

interface Fixture {
  schema: string;
  cases: { name: string; valid: boolean; value: unknown }[];
}

for (const [domain, validators] of Object.entries(domains)) {
  const fixturesDir = join(contractsDir, domain, "fixtures");
  for (const file of readdirSync(fixturesDir).filter((name) => name.endsWith(".json"))) {
    const fixture: Fixture = JSON.parse(readFileSync(join(fixturesDir, file), "utf8"));
    describe(`${domain}/${file}`, () => {
      const validate = validators[`validate${fixture.schema}`];
      test("the fixture names a generated validator", () => {
        expect(typeof validate).toBe("function");
      });
      for (const c of fixture.cases) {
        test(c.name, () => {
          expect(validate(c.value)).toBe(c.valid);
        });
      }
    });
  }
}
