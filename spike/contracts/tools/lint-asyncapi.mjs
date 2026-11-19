// Fails when asyncapi.yaml does not parse as AsyncAPI 3.x or when a message payload points at a missing schema file.
import { Parser, fromFile } from "@asyncapi/parser";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = resolve(import.meta.dirname, "../asyncapi.yaml");
const { document, diagnostics } = await fromFile(new Parser(), file).parse();
const errors = diagnostics.filter((d) => d.severity === 0);
if (!document || errors.length > 0) {
  console.error(errors.map((d) => `${d.code}: ${d.message} @ ${d.path?.join("/")}`).join("\n"));
  process.exit(1);
}
const refs = [...readFileSync(file, "utf8").matchAll(/\$ref: '(\.\/schemas\/[^']+)'/g)].map((m) => m[1]);
const missing = refs.filter((r) => !existsSync(resolve(import.meta.dirname, "..", r)));
if (missing.length > 0) {
  console.error(`asyncapi.yaml references missing schemas: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`asyncapi: ${document.channels().all().length} channels, ${document.operations().all().length} operations, ${refs.length} schema refs ok`);
