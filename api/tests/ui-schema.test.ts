import { describe, expect, test } from "bun:test";
import { type ConfigField, configFieldExamplePayload, type DataShape, parseDataShape } from "@woofx3/api/ui-schema";

// parseDataShape is the one place that decides whether a trigger's `emits` /
// an action's `returns` names anything at all. Every "no" answer means the
// consumer falls back to deriving variables from configFields, so the failure
// modes matter as much as the success one.
describe("parseDataShape", () => {
  test("parses a declared schema", () => {
    const raw = JSON.stringify({
      fields: [
        { path: "bits", type: "number", description: "Bits cheered" },
        { path: "channel.title", type: "string", example: "woof stream" },
      ],
    } satisfies DataShape);

    expect(parseDataShape(raw)).toEqual({
      fields: [
        { path: "bits", type: "number", description: "Bits cheered" },
        { path: "channel.title", type: "string", example: "woof stream" },
      ],
    });
  });

  // The db column defaults to "{}", and modules that never migrate write
  // nothing at all. Both have to read as "fall back", not as "declares zero
  // variables".
  test.each([
    ["undefined", undefined],
    ["null", null],
    ["empty string", ""],
    ["the column default", "{}"],
    ["an object with no fields key", '{"other":1}'],
    ["an empty fields array", '{"fields":[]}'],
  ])("returns undefined for %s", (_label, raw) => {
    expect(parseDataShape(raw as string | undefined | null)).toBeUndefined();
  });

  // The removed `outputs` key held a ConfigField[] array. A manifest that
  // still carries one must read as "declared nothing", not throw.
  test("returns undefined for the removed ConfigField array form", () => {
    const legacy = JSON.stringify([{ id: "next", label: "New value", type: "number" }]);

    expect(parseDataShape(legacy)).toBeUndefined();
  });

  // A module author's typo must not throw inside a variable picker.
  test("returns undefined for malformed JSON instead of throwing", () => {
    expect(parseDataShape("{not json")).toBeUndefined();
  });

  test("returns undefined for a fields value that is not an array", () => {
    expect(parseDataShape('{"fields":{"bits":"number"}}')).toBeUndefined();
  });

  test("drops entries with no usable path and keeps the rest", () => {
    const raw = JSON.stringify({
      fields: [{ path: "bits", type: "number" }, { type: "string" }, { path: "", type: "string" }, null, "nope"],
    });

    expect(parseDataShape(raw)).toEqual({ fields: [{ path: "bits", type: "number" }] });
  });

  test("returns undefined when every entry is unusable", () => {
    expect(parseDataShape('{"fields":[{"type":"string"},null]}')).toBeUndefined();
  });
});

// examplePayload was called dataSchema. Both names have to resolve while
// manifests and stored rows written before the rename are still in the wild.
describe("configFieldExamplePayload", () => {
  const base: ConfigField = { id: "minBits", label: "Minimum bits", type: "number" };

  test("reads the current name", () => {
    expect(configFieldExamplePayload({ ...base, examplePayload: '{"bits":1000}' })).toBe('{"bits":1000}');
  });

  test("falls back to the pre-rename name", () => {
    expect(configFieldExamplePayload({ ...base, dataSchema: '{"bits":1000}' })).toBe('{"bits":1000}');
  });

  // A field carrying both is taking the new name at its word.
  test("prefers the current name when a field carries both", () => {
    const field = { ...base, examplePayload: '{"new":true}', dataSchema: '{"old":true}' };

    expect(configFieldExamplePayload(field)).toBe('{"new":true}');
  });

  test("returns undefined when a field declares neither", () => {
    expect(configFieldExamplePayload(base)).toBeUndefined();
  });
});
