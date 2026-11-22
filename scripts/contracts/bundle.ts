// Resolves the cross-file $refs of every contract source into one self-contained OpenAPI JSON document, then writes
// one document per language holding only the operations that language consumes (`x-consumers` on the operation) and
// the schemas those operations reach. A language no operation names gets no document, so nothing is generated for it.
// Usage: bun bundle.ts <out dir> <openapi.yaml>...
// Writes <out dir>/{all,go,ts,rust}.json.
import { bundle, createConfig } from "@redocly/openapi-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

const LANGUAGES = ["go", "ts", "rust"] as const;
type Language = (typeof LANGUAGES)[number];

type Json = Record<string, unknown>;
interface Operation extends Json {
  operationId: string;
  "x-consumers"?: unknown;
}
interface Document extends Json {
  paths: Record<string, { post: Operation }>;
  components: { schemas: Record<string, unknown> };
}

const fail = (message: string): never => {
  console.error(`bundle: ${message}`);
  process.exit(1);
};

const [outDir, ...sources] = process.argv.slice(2);
if (!outDir || sources.length === 0) {
  fail("usage: bun bundle.ts <out dir> <openapi.yaml>...");
}

const merged: Document = {
  openapi: "3.1.0",
  info: { title: "woofx3 bus messages", version: "1.0.0" },
  paths: {},
  components: { schemas: {} },
};
const operationOwners = new Map<string, string>();
const collisions: string[] = [];

for (const source of sources) {
  const { bundle: result, problems } = await bundle({ ref: source, config: await createConfig({}) });
  if (problems.some((p) => p.severity === "error")) {
    fail(`${source}: ${problems.map((p) => p.message).join("; ")}`);
  }
  const doc = result.parsed as Document;
  for (const [path, item] of Object.entries(doc.paths)) {
    if (merged.paths[path]) {
      fail(`${source}: path ${path} is also defined by another source`);
    }
    const id = item.post.operationId;
    if (operationOwners.has(id)) {
      fail(`${source}: operationId ${id} is also defined by ${operationOwners.get(id)}`);
    }
    operationOwners.set(id, source);
    merged.paths[path] = item;
  }
  for (const [name, schema] of Object.entries(doc.components.schemas)) {
    const existing = merged.components.schemas[name];
    if (existing !== undefined && !isDeepStrictEqual(existing, schema)) {
      collisions.push(`${source}: schema ${name} differs from the one of the same name in another source`);
    }
    merged.components.schemas[name] = schema;
  }
}

if (collisions.length > 0) {
  fail(collisions.join("\n"));
}

const consumersOf = (path: string, operation: Operation): Language[] => {
  const declared = operation["x-consumers"];
  if (!Array.isArray(declared) || declared.length === 0) {
    return fail(`${path} (${operation.operationId}) needs x-consumers naming at least one of ${LANGUAGES.join(", ")}`);
  }
  for (const language of declared) {
    if (!LANGUAGES.includes(language)) {
      fail(`${path}: x-consumers names ${JSON.stringify(language)}, expected one of ${LANGUAGES.join(", ")}`);
    }
  }
  return declared as Language[];
};

const refsOf = (node: unknown, found: Set<string> = new Set()): Set<string> => {
  if (Array.isArray(node)) {
    for (const item of node) {
      refsOf(item, found);
    }
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") {
        found.add(value.slice(value.lastIndexOf("/") + 1));
      } else {
        refsOf(value, found);
      }
    }
  }
  return found;
};

const forLanguage = (language: Language): Document | null => {
  const paths: Document["paths"] = {};
  for (const [path, item] of Object.entries(merged.paths)) {
    if (consumersOf(path, item.post).includes(language)) {
      paths[path] = item;
    }
  }
  if (Object.keys(paths).length === 0) {
    return null;
  }
  const schemas: Record<string, unknown> = {};
  const pending = [...refsOf(paths)];
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    if (name in schemas) {
      continue;
    }
    const schema = merged.components.schemas[name];
    if (schema === undefined) {
      fail(`a $ref names schema ${name}, which no source defines`);
    }
    schemas[name] = schema;
    pending.push(...refsOf(schema));
  }
  return { ...merged, paths, components: { schemas } };
};

mkdirSync(outDir, { recursive: true });
const write = (name: string, doc: Document) =>
  writeFileSync(`${outDir}/${name}.json`, `${JSON.stringify(doc, null, 2)}\n`);
write("all", merged);
for (const language of LANGUAGES) {
  const doc = forLanguage(language);
  if (doc) {
    write(language, doc);
  }
}
