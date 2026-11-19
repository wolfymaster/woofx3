// Does every component of a document compile in Ajv? Usage: compile-all.ts <doc>
import Ajv2020 from "ajv/dist/2020";
import Ajv04 from "ajv-draft-04";
import addFormats from "ajv-formats";
import { parse } from "yaml";
import { readFileSync } from "node:fs";
for (const file of process.argv.slice(2)) {
  const doc = parse(readFileSync(file, "utf8"));
  for (const [label, Ctor] of [["Ajv2020", Ajv2020], ["Ajv draft-04", Ajv04]] as const) {
    const errors: string[] = []; let ok = 0;
    for (const name of Object.keys(doc.components.schemas)) {
      try { const a = new (Ctor as any)({ strict: false }); addFormats(a); a.compile({ $ref: `#/components/schemas/${name}`, components: doc.components }); ok++; } catch (e) { errors.push(`${name}: ${String(e).slice(0, 90)}`); }
    }
    console.log(`${file} ${doc.openapi} ${label}: ${ok} compile, ${errors.length} fail`, errors.slice(0, 3));
  }
}
