// A JSON Schema for a composition document, emitted from a registry.
//
// For tools that check a composition without running this code: a module's
// manifest ships compositions, and whatever installs the module can check
// each document against the schema of the engine's strict registry. The
// schema says what the registry checks entry by entry; what spans entries
// (a behavior targeting a widget that exists, a widget kind the widget
// declares) is outside it, as it is outside the registry.

import { ENTRY_ID_MAX_LENGTH } from "./entity-types";
import type { CollectionName, JsonSchema, TypeRegistry } from "./registry";

export const JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";

/** The schema of a whole composition document under `registry`. */
export function compositionJsonSchema(registry: TypeRegistry): JsonSchema {
  const open = registry.mode === "tolerant";
  const properties: Record<string, JsonSchema> = { layout: { type: "object" } };
  for (const collection of registry.collectionNames()) {
    properties[collection] = {
      type: "object",
      propertyNames: { minLength: 1, maxLength: ENTRY_ID_MAX_LENGTH },
      additionalProperties: entryJsonSchema(registry, collection),
    };
  }
  properties.inputs = { type: "array", items: INPUT_FIELD_SCHEMA };
  properties.base = {
    type: "object",
    required: ["id", "version"],
    properties: { id: { type: "string", minLength: 1 }, version: { type: "string", minLength: 1 } },
    additionalProperties: open,
  };
  return {
    $schema: JSON_SCHEMA_DIALECT,
    title: "Composition",
    type: "object",
    required: ["layout", ...registry.collectionNames()],
    properties,
    additionalProperties: open,
  };
}

/**
 * The schema of one entry of `collection`: the fields every entry has, and
 * exactly one of the registered types' constraints. A tolerant registry
 * also accepts an entry of any type it does not know.
 */
export function entryJsonSchema(registry: TypeRegistry, collection: CollectionName): JsonSchema {
  const definition = registry.collection(collection);
  const fields = Object.entries(definition.fields);
  const base: JsonSchema = {
    type: "object",
    required: fields.map(([name]) => name),
    properties: Object.fromEntries(fields.map(([name, spec]) => [name, spec.schema])),
    additionalProperties: registry.mode === "tolerant",
  };
  const types = registry.typesOf(collection);
  // Every placement is a `widget`; no field picks among types to branch on.
  if (collection === "widgets") {
    return { allOf: [base, ...types.map((type) => type.schema(registry.mode))] };
  }
  const branches = types.map((type) => type.schema(registry.mode));
  if (registry.mode === "strict") {
    return { allOf: [base, { oneOf: branches }] };
  }
  const unknownType: JsonSchema = {
    type: "object",
    required: ["type"],
    properties: { type: { type: "string", not: { enum: types.map((type) => type.name) } } },
  };
  return { oneOf: [{ allOf: [base, { oneOf: branches }] }, unknownType] };
}

/** An input as the engine's `ConfigField` has it: the fields every input needs, others kept. */
const INPUT_FIELD_SCHEMA: JsonSchema = {
  type: "object",
  required: ["id", "label", "type"],
  properties: {
    id: { type: "string", minLength: 1 },
    label: { type: "string" },
    type: { type: "string", minLength: 1 },
    description: { type: "string" },
  },
};
