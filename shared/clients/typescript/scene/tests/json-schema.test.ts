import { describe, expect, test } from "bun:test";
import {
  type CompositionDocument,
  compositionJsonSchema,
  JSON_SCHEMA_DIALECT,
  type JsonSchema,
  STRICT_REGISTRY,
  TOLERANT_REGISTRY,
} from "../model";

interface SchemaKeywords {
  type?: string;
  const?: unknown;
  enum?: unknown[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: JsonSchema | boolean;
  propertyNames?: JsonSchema;
  items?: JsonSchema;
  allOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  not?: JsonSchema;
}

/**
 * Whether `value` conforms to `schema`, for the keywords the emitted schema
 * uses. Small enough to read, so the test checks the schema means what the
 * registry means without a validator dependency.
 */
function conforms(schema: JsonSchema | boolean, value: unknown): boolean {
  if (typeof schema === "boolean") {
    return schema;
  }
  const s = schema as SchemaKeywords;
  const isObject = typeof value === "object" && value !== null && !Array.isArray(value);
  if (s.type !== undefined && !hasType(s.type, value)) {
    return false;
  }
  if (s.const !== undefined && JSON.stringify(s.const) !== JSON.stringify(value)) {
    return false;
  }
  if (s.enum !== undefined && !s.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))) {
    return false;
  }
  if (typeof value === "string") {
    if (
      (s.minLength !== undefined && value.length < s.minLength) ||
      (s.maxLength !== undefined && value.length > s.maxLength)
    ) {
      return false;
    }
    if (s.pattern !== undefined && !new RegExp(s.pattern, "u").test(value)) {
      return false;
    }
  }
  if (typeof value === "number") {
    if ((s.minimum !== undefined && value < s.minimum) || (s.maximum !== undefined && value > s.maximum)) {
      return false;
    }
  }
  if (isObject) {
    const record = value as Record<string, unknown>;
    if (s.required !== undefined && !s.required.every((key) => Object.hasOwn(record, key))) {
      return false;
    }
    for (const [key, item] of Object.entries(record)) {
      if (s.propertyNames !== undefined && !conforms(s.propertyNames, key)) {
        return false;
      }
      if (s.properties !== undefined && Object.hasOwn(s.properties, key)) {
        if (!conforms(s.properties[key], item)) {
          return false;
        }
      } else if (s.additionalProperties !== undefined && !conforms(s.additionalProperties, item)) {
        return false;
      }
    }
  }
  if (Array.isArray(value) && s.items !== undefined && !value.every((item) => conforms(s.items as JsonSchema, item))) {
    return false;
  }
  if (s.allOf !== undefined && !s.allOf.every((sub) => conforms(sub, value))) {
    return false;
  }
  if (s.anyOf !== undefined && !s.anyOf.some((sub) => conforms(sub, value))) {
    return false;
  }
  if (s.oneOf !== undefined && s.oneOf.filter((sub) => conforms(sub, value)).length !== 1) {
    return false;
  }
  if (s.not !== undefined && conforms(s.not, value)) {
    return false;
  }
  return true;
}

function hasType(type: string, value: unknown): boolean {
  switch (type) {
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    default:
      return typeof value === type;
  }
}

function composition(): CompositionDocument {
  return {
    layout: { width: 1920, height: 1080 },
    widgets: {
      w1: {
        widget: "woofx3:widget:text",
        x: 10,
        y: 20,
        width: 300,
        height: 80,
        visible: true,
        z: "a0",
        settings: { text: "{{user}}" },
        name: "Title",
        rotation: 0,
        opacity: 1,
        locked: false,
        extra: {},
      },
    },
    behaviors: {
      in: {
        type: "transition",
        kind: "slide",
        target: "w1",
        order: "a0",
        timing: { anchor: "enter", offsetMs: 0, durationMs: 400, easing: "ease-out" },
        params: { phase: "in", direction: "up" },
      },
      typing: {
        type: "transition",
        kind: "typewriter",
        target: "w1",
        order: "a1",
        timing: { anchor: "enter", offsetMs: 500, durationMs: 1200, easing: "linear" },
        params: { phase: "in", cursor: true },
      },
      shake: {
        type: "effect",
        kind: "shake",
        target: "canvas",
        order: "a0",
        timing: { anchor: "start", offsetMs: 0, durationMs: "until-exit", easing: "ease-in-out" },
        params: { distancePx: 8 },
      },
      window: {
        type: "activity",
        kind: "window",
        target: "w1",
        order: "a0",
        timing: { anchor: "start", offsetMs: 500, durationMs: 3000, easing: "linear" },
        params: {},
      },
    },
    inputs: [{ id: "user", label: "User", type: "text", defaultValue: "someone" }],
  };
}

describe("compositionJsonSchema", () => {
  const strict = compositionJsonSchema(STRICT_REGISTRY);
  const tolerant = compositionJsonSchema(TOLERANT_REGISTRY);

  test("is a draft 2020-12 schema that survives JSON", () => {
    expect(strict.$schema).toBe(JSON_SCHEMA_DIALECT);
    expect(JSON.parse(JSON.stringify(strict))).toEqual(strict);
  });

  test("a document the registry accepts conforms", () => {
    const doc = composition();
    for (const [id, behavior] of Object.entries(doc.behaviors)) {
      expect([id, STRICT_REGISTRY.invalidEntry("behaviors", behavior)]).toEqual([id, null]);
    }
    expect(conforms(strict, doc)).toBe(true);
    expect(conforms(tolerant, doc)).toBe(true);
  });

  const refusedByBoth: Array<[string, (doc: CompositionDocument) => unknown]> = [
    ["a placement missing a field", (doc) => delete (doc.widgets.w1 as Partial<typeof doc.widgets.w1>).name],
    ["an opacity above 1", (doc) => (doc.widgets.w1.opacity = 2)],
    ["a transition without a phase", (doc) => (doc.behaviors.in.params = {})],
    ["a transition too long", (doc) => (doc.behaviors.in.timing.durationMs = 60_000)],
    ["a slide going nowhere", (doc) => (doc.behaviors.in.params.direction = "inward")],
    ["an unknown anchor", (doc) => ((doc.behaviors.in.timing as { anchor: string }).anchor = "midway")],
    ["an activity on the canvas", (doc) => (doc.behaviors.window.target = "canvas")],
    ["an instant effect", (doc) => (doc.behaviors.shake.timing.durationMs = 0)],
    ["a document without behaviors", (doc) => delete (doc as Partial<CompositionDocument>).behaviors],
  ];
  for (const [name, change] of refusedByBoth) {
    test(`refuses ${name}`, () => {
      const doc = composition();
      change(doc);
      expect(conforms(strict, doc)).toBe(false);
    });
  }

  const refusedOnlyByStrict: Array<[string, (doc: CompositionDocument) => unknown]> = [
    ["an unknown behavior type", (doc) => (doc.behaviors.in.type = "sound")],
    ["a placement field it does not know", (doc) => ((doc.widgets.w1 as unknown as Record<string, unknown>).blend = 1)],
    ["a host kind's unknown param", (doc) => (doc.behaviors.shake.params.speed = 3)],
    ["a root key it does not know", (doc) => ((doc as unknown as Record<string, unknown>).timelines = {})],
  ];
  for (const [name, change] of refusedOnlyByStrict) {
    test(`the strict schema refuses, and the tolerant one keeps, ${name}`, () => {
      const doc = composition();
      change(doc);
      expect(conforms(strict, doc)).toBe(false);
      expect(conforms(tolerant, doc)).toBe(true);
    });
  }
});
