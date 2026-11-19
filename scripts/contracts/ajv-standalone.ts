// Precompiles one Ajv validator per component schema of a bundled contract document into an ES module, so a consumer
// needs neither the document nor a compile step at run time. Each is exported as `validate<Schema>`, a type guard for
// the schema's generated type, with Ajv's `errors` set after a failed call. The module sits beside the types file
// openapi-typescript wrote. Usage: bun ajv-standalone.ts <doc.json> <types file name> <out.ts>
import Ajv2020 from "ajv/dist/2020";
import standaloneCode from "ajv/dist/standalone";
import { readFileSync, writeFileSync } from "node:fs";

const [docPath, typesFile, outPath] = process.argv.slice(2);
// Ajv's `discriminator` keyword refuses `mapping`, which the other generators need. The variants' single-value
// `status` enums already exclude one another, so the plain `oneOf` validates the same values.
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
const names: string[] = Object.keys(doc.components.schemas);
const ajv = new Ajv2020({ code: { source: true, esm: true } });
ajv.addKeyword("components"); // the document root is the schema, so its components resolve as local refs
ajv.addSchema({ $id: "doc", components: doc.components });
const refs = Object.fromEntries(names.map((name) => [`compiled${name}`, `doc#/components/schemas/${name}`]));
const typed = names.map(
  (name) => `export const validate${name} = compiled${name} as unknown as Validator<components["schemas"]["${name}"]>;`
);
writeFileSync(
  outPath,
  [
    `import type { ErrorObject } from "ajv";`,
    `import type { components } from "./${typesFile.replace(/\.ts$/, "")}";`,
    `type Validator<T> = ((value: unknown) => value is T) & { errors?: ErrorObject[] | null };`,
    standaloneCode(ajv, refs),
    ...typed,
    "",
  ].join("\n")
);
