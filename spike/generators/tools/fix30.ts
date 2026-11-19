// Residue openapi-down-convert 0.14.2 leaves in 3.0.3 output: `const` inside path-level schemas, numeric
// exclusiveMinimum/Maximum, and anyOf/oneOf [X, {type: null}]. Usage: fix30.ts <in> <out>
import { parse, stringify } from "yaml";
import { readFileSync, writeFileSync } from "node:fs";
const [inp, out] = process.argv.slice(2);
const doc = parse(readFileSync(inp, "utf8"));
const isNull = (m: any) => m && m.type === "null";
function fix(n: any): any {
  if (Array.isArray(n)) { return n.map(fix); }
  if (!n || typeof n !== "object") { return n; }
  const o: any = {};
  for (const [k, v] of Object.entries<any>(n)) { o[k] = fix(v); }
  // 3.0 has no if/then/else; the conditional allOf entries are dropped (a loss, reported by the spike).
  for (const k of ["if", "then", "else"]) { delete o[k]; }
  if (Array.isArray(o.allOf)) { o.allOf = o.allOf.filter((e: any) => Object.keys(e).some((k) => !["description"].includes(k))); if (!o.allOf.length) { delete o.allOf; } }
  if ("const" in o) { o.enum = [o.const]; o.type ??= typeof o.const; delete o.const; }
  for (const [num, flag, bound] of [["exclusiveMinimum", "exclusiveMinimum", "minimum"], ["exclusiveMaximum", "exclusiveMaximum", "maximum"]]) {
    if (typeof o[num] === "number") { o[bound] = o[num]; o[flag] = true; }
  }
  for (const key of ["anyOf", "oneOf"]) {
    if (Array.isArray(o[key]) && o[key].some(isNull)) {
      const rest = o[key].filter((m: any) => !isNull(m));
      delete o[key];
      o.nullable = true;
      if (rest.length === 1) { o.allOf = [...(o.allOf ?? []), rest[0]]; } else { o[key] = rest; }
    }
  }
  return o;
}
writeFileSync(out, stringify(fix(doc), { lineWidth: 0 }));
