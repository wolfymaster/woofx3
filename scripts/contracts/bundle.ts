// Resolves the cross-file $refs of one contract document into a single self-contained OpenAPI JSON document, the
// input every generator reads. Usage: bun bundle.ts <openapi.yaml> <out.json>
import { bundle, createConfig } from "@redocly/openapi-core";
import { writeFileSync } from "node:fs";

const [source, out] = process.argv.slice(2);
const { bundle: result, problems } = await bundle({ ref: source, config: await createConfig({}) });
if (problems.some((p) => p.severity === "error")) {
  console.error(problems.map((p) => p.message).join("\n"));
  process.exit(1);
}
writeFileSync(out, `${JSON.stringify(result.parsed, null, 2)}\n`);
