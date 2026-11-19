// Every schema file, read from disk at load time; Bun can import JSON, so this has no network and no codegen.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type JsonSchema = { $id: string; [key: string]: unknown };

const schemaRoot = resolve(import.meta.dirname, "../schemas");

export function loadSchemas(): JsonSchema[] {
  return readdirSync(schemaRoot, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(schemaRoot, f), "utf8")) as JsonSchema);
}

// Consumers tolerate fields added by a newer producer: drop additionalProperties:false and keep every other check.
// Same transform as the backoffice spec validator.
export function allowExtraFields<T>(schema: T): T {
  if (Array.isArray(schema)) {
    return schema.map(allowExtraFields) as T;
  }
  if (schema !== null && typeof schema === "object") {
    return Object.fromEntries(
      Object.entries(schema)
        .filter(([key, value]) => !(key === "additionalProperties" && value === false))
        .map(([key, value]) => [key, allowExtraFields(value)])
    ) as T;
  }
  return schema;
}
