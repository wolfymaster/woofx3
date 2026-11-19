// Precompiles one validator per component schema of an OpenAPI 3.1 document, strict and lenient (additionalProperties
// false dropped, the consumer-side policy for replies). Usage: gen-ajv-standalone.ts <doc.json> <outDir>
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import standaloneCode from "ajv/dist/standalone";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [docPath, outDir] = process.argv.slice(2);
const doc = JSON.parse(readFileSync(docPath, "utf8"));
const lenient = (n: unknown): unknown =>
  Array.isArray(n) ? n.map(lenient)
  : n && typeof n === "object" ? Object.fromEntries(Object.entries(n).filter(([k, v]) => !(k === "additionalProperties" && v === false)).map(([k, v]) => [k, lenient(v)]))
  : n;

for (const [mode, source] of [["strict", doc], ["lenient", lenient(doc)]] as const) {
  const ajv = new Ajv2020({ strict: false, code: { source: true, esm: false }, schemas: [{ $id: "doc", components: (source as any).components }] });
  addFormats(ajv);
  const refs = Object.fromEntries(Object.keys(doc.components.schemas).map((n) => [n, `doc#/components/schemas/${n}`]));
  writeFileSync(join(outDir, `validators.${mode}.cjs`), standaloneCode(ajv, refs));
}
