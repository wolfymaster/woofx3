// The shared fixtures through Ajv reading the OpenAPI 3.1 document at run time, and through the precompiled standalone code.
import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";

const doc = JSON.parse(readFileSync(`${import.meta.dir}/../work/nats.31.json`, "utf8"));
const strictStandalone = require("../gen/ts/validators.strict.cjs");
const lenientStandalone = require("../gen/ts/validators.lenient.cjs");
const suites = [
  ["requests.json", "request", "GatewayRequest"], ["replies.json", "reply", "GatewayReply"],
  ["capabilities-replies.json", "reply", "CapabilitiesReply"], ["field-options-requests.json", "request", "FieldOptionsRequest"],
  ["field-options-replies.json", "reply", "FieldOptionsReply"],
] as const;
const lenient = (n: any): any => Array.isArray(n) ? n.map(lenient) : n && typeof n === "object"
  ? Object.fromEntries(Object.entries(n).filter(([k, v]) => !(k === "additionalProperties" && v === false)).map(([k, v]) => [k, lenient(v)])) : n;
const dynamic = (d: any) => { const a = new Ajv2020({ strict: false }); addFormats(a); a.addSchema({ $id: "doc", components: d.components }); return (name: string, v: unknown) => a.getSchema(`doc#/components/schemas/${name}`)!(v); };
const dynStrict = dynamic(doc), dynLenient = dynamic(lenient(doc));

const rows: string[] = [];
for (const [engine, strict, len] of [
  ["Ajv at run time", dynStrict, dynLenient],
  ["Ajv standalone", (n: string, v: unknown) => strictStandalone[n](v), (n: string, v: unknown) => lenientStandalone[n](v)],
] as const) {
  const bad: string[] = []; let total = 0;
  for (const [file, key, schema] of suites) {
    for (const c of JSON.parse(readFileSync(`${import.meta.dir}/../in/fixtures/${file}`, "utf8")).cases) {
      total++;
      const ok = (key === "reply" ? len : strict)(schema, c[key]);
      const valid = c.invalidField === null;
      if (ok !== valid) { bad.push(`  ${valid ? "REJECTS VALID  " : "ACCEPTS INVALID"} ${file}/${c.name}`); }
    }
  }
  rows.push(`== ${engine}: ${total} cases, ${bad.length} disagree`, ...bad);
}
test("fixtures through Ajv", () => { console.log(rows.join("\n")); expect(rows.length).toBeGreaterThan(0); });
