// Prunes the marketplace spec to chosen operations plus every component they reach. Usage: slice.ts <in.yaml> <out.yaml> <opId...>
import { parse, stringify } from "yaml";
import { readFileSync, writeFileSync } from "node:fs";
const [inp, out, ...ops] = process.argv.slice(2);
const doc = parse(readFileSync(inp, "utf8"));
const paths: Record<string, any> = {};
for (const [p, item] of Object.entries<any>(doc.paths)) {
  const keep: any = {};
  for (const [m, op] of Object.entries<any>(item)) {
    if (op?.operationId && ops.includes(op.operationId)) { keep[m] = op; }
  }
  if (Object.keys(keep).length) {
    if (item.parameters) { keep.parameters = item.parameters; }
    paths[p] = keep;
  }
}
const used = new Set<string>();
const visit = (n: any) => {
  if (Array.isArray(n)) { n.forEach(visit); return; }
  if (n && typeof n === "object") {
    for (const [k, v] of Object.entries<any>(n)) {
      if (k === "$ref" && typeof v === "string") {
        if (!used.has(v)) {
          used.add(v);
          const [, , sect, name] = v.split("/");
          visit(doc.components[sect][name]);
        }
      } else { visit(v); }
    }
  }
};
visit(paths);
const components: any = { securitySchemes: doc.components.securitySchemes };
for (const r of used) {
  const [, , sect, name] = r.split("/");
  (components[sect] ??= {})[name] = doc.components[sect][name];
}
const slim = { openapi: doc.openapi, info: { title: "marketplace slice", version: "1.0.0" }, paths, components };
// A response component and a schema both named Error collide in Go generators; the real spec has the same clash.
const text = stringify(slim, { lineWidth: 0 }).replaceAll("#/components/responses/Error", "#/components/responses/ErrorReply").replace(/^    Error:\n(?=      description: An error)/m, "    ErrorReply:\n");
writeFileSync(out, text);
