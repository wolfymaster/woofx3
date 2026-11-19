// Folds every schema file into one document whose $defs are the files, with cross-file $refs rewritten to local ones.
// Tools that cannot follow $ref between files (typify) read the result.
import { writeFileSync } from "node:fs";
import { loadSchemas, type JsonSchema } from "../ts/schemas";

const schemas = loadSchemas();
const nameOf = new Map(schemas.map((s) => [s.$id, s.title as string]));

function rewrite(node: unknown, base: string): unknown {
  if (Array.isArray(node)) {
    return node.map((n) => rewrite(n, base));
  }
  if (node === null || typeof node !== "object") {
    return node;
  }
  // Typify cannot merge conditional subschemas; they only constrain values, never shape, so codegen input omits them.
  const dropConditionals = (e: [string, unknown]) => !["if", "then", "else"].includes(e[0]);
  return Object.fromEntries(
    Object.entries(node as Record<string, unknown>).filter(dropConditionals).map(([k, v]) => {
      if (k === "allOf" && Array.isArray(v)) {
        const kept = v.filter((entry) => !("if" in entry));
        return kept.length === 0 ? ["$comment", "conditionals omitted for codegen"] : [k, rewrite(kept, base)];
      }
      if (k === "$ref" && typeof v === "string") {
        const target = nameOf.get(new URL(v, base).href);
        if (!target) {
          throw new Error(`unresolvable $ref ${v} from ${base}`);
        }
        return [k, `#/$defs/${target}`];
      }
      return [k, rewrite(v, base)];
    })
  );
}

const defs: Record<string, unknown> = {};
for (const s of schemas) {
  const { $id, $schema, ...rest } = s as JsonSchema & { $schema: string };
  defs[s.title as string] = rewrite(rest, $id);
}
const bundle = { $schema: "https://json-schema.org/draft/2020-12/schema", title: "Contracts", $defs: defs };
writeFileSync(process.argv[2], JSON.stringify(bundle, null, 2) + "\n");
