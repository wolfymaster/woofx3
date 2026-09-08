import { describe, expect, test } from "bun:test";
import { type DataSchema, parseDataSchema } from "@woofx3/api/ui-schema";

// parseDataSchema is the one place that decides whether a trigger's
// payloadSchema / an action's outputSchema declares anything at all. Every
// "no" answer means the consumer falls back to deriving variables from
// configFields / outputFields, so the failure modes matter as much as the
// success one.
describe("parseDataSchema", () => {
  test("parses a declared schema", () => {
    const raw = JSON.stringify({
      fields: [
        { path: "bits", type: "number", description: "Bits cheered" },
        { path: "channel.title", type: "string", example: "woof stream" },
      ],
    } satisfies DataSchema);

    expect(parseDataSchema(raw)).toEqual({
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
    expect(parseDataSchema(raw as string | undefined | null)).toBeUndefined();
  });

  // outputSchema has always held a ConfigField[] array and still may. An
  // array is the signal to read it the old way, not an error.
  test("returns undefined for the legacy ConfigField array form", () => {
    const legacy = JSON.stringify([{ id: "next", label: "New value", type: "number" }]);

    expect(parseDataSchema(legacy)).toBeUndefined();
  });

  // A module author's typo must not throw inside a variable picker.
  test("returns undefined for malformed JSON instead of throwing", () => {
    expect(parseDataSchema("{not json")).toBeUndefined();
  });

  test("returns undefined for a fields value that is not an array", () => {
    expect(parseDataSchema('{"fields":{"bits":"number"}}')).toBeUndefined();
  });

  test("drops entries with no usable path and keeps the rest", () => {
    const raw = JSON.stringify({
      fields: [{ path: "bits", type: "number" }, { type: "string" }, { path: "", type: "string" }, null, "nope"],
    });

    expect(parseDataSchema(raw)).toEqual({ fields: [{ path: "bits", type: "number" }] });
  });

  test("returns undefined when every entry is unusable", () => {
    expect(parseDataSchema('{"fields":[{"type":"string"},null]}')).toBeUndefined();
  });
});
