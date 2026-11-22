// Checks every contract fixture against the merged contract document with Ajv, whichever languages consume the
// message: the schema a fixture names must exist and each case must get the verdict it states. The per-language
// tests then check the generated code of the languages that consume the message against the same files.
// Usage: bun fixtures.ts <all.json> <fixtures dir>...
import Ajv2020 from "ajv/dist/2020";
import { readdirSync, readFileSync } from "node:fs";

interface Fixture {
  schema: string;
  cases: { name: string; valid: boolean; value: unknown }[];
}

const [docPath, ...dirs] = process.argv.slice(2);

// Ajv's `discriminator` keyword refuses `mapping`; the variants' constant `status` values already exclude one another.
const withoutDiscriminator = (node: unknown): unknown =>
  Array.isArray(node)
    ? node.map(withoutDiscriminator)
    : node && typeof node === "object"
      ? Object.fromEntries(
          Object.entries(node)
            .filter(([key]) => key !== "discriminator")
            .map(([key, value]) => [key, withoutDiscriminator(value)])
        )
      : node;

const doc = withoutDiscriminator(JSON.parse(readFileSync(docPath, "utf8"))) as { components: { schemas: object } };
const ajv = new Ajv2020({ strict: false });
ajv.addKeyword("components");
ajv.addSchema({ $id: "doc", components: doc.components });

const problems: string[] = [];
let checked = 0;
for (const dir of dirs) {
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
    const fixture: Fixture = JSON.parse(readFileSync(`${dir}/${file}`, "utf8"));
    if (!(fixture.schema in doc.components.schemas)) {
      problems.push(`${dir}/${file}: names schema ${fixture.schema}, which the contracts do not define`);
      continue;
    }
    const validate = ajv.getSchema(`doc#/components/schemas/${fixture.schema}`);
    if (!validate) {
      problems.push(`${dir}/${file}: schema ${fixture.schema} did not compile`);
      continue;
    }
    for (const c of fixture.cases) {
      checked += 1;
      if (validate(c.value) !== c.valid) {
        problems.push(`${dir}/${file}: case "${c.name}" should be ${c.valid ? "valid" : "invalid"}`);
      }
    }
  }
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`fixtures: ${checked} cases agree with the contract document`);
