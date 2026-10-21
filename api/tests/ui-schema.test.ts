import { describe, expect, test } from "bun:test";
import { type DataShape, type DataShapeField, parseDataShape } from "@woofx3/api/ui-schema";

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

  test("keeps a field's options", () => {
    const raw = JSON.stringify({
      fields: [
        {
          path: "tier",
          type: "string",
          options: [
            { value: "1000", label: "Tier 1" },
            { value: "2000", label: "Tier 2" },
          ],
        },
        { path: "level", type: "number", options: [{ value: 1, label: "Low" }] },
      ],
    } satisfies DataShape);

    expect(parseDataShape(raw)?.fields).toEqual([
      {
        path: "tier",
        type: "string",
        options: [
          { value: "1000", label: "Tier 1" },
          { value: "2000", label: "Tier 2" },
        ],
      },
      { path: "level", type: "number", options: [{ value: 1, label: "Low" }] },
    ]);
  });

  // A picker missing one of the values a field can hold is worse than a
  // free-text box, so one malformed entry drops the whole list.
  test.each([
    ["an empty list", []],
    ["a list that is not an array", { value: "a", label: "A" }],
    ["an entry without a label", [{ value: "a", label: "A" }, { value: "b" }]],
    ["an entry whose value is not a scalar", [{ value: ["a"], label: "A" }]],
  ])("drops the options of %s and keeps the field", (_label, options) => {
    const raw = JSON.stringify({ fields: [{ path: "tier", type: "string", options }] });

    expect(parseDataShape(raw)?.fields).toEqual([{ path: "tier", type: "string" }]);
  });

  test("keeps a summary, its details and identity annotations", () => {
    const raw = JSON.stringify({
      summary: "{userName} redeemed {rewardTitle}",
      details: ["\u201c{message}\u201d"],
      fields: [
        { path: "userId", type: "string", identity: "viewer", anonymousWhen: "isAnonymous", displayName: "userName" },
        { path: "isAnonymous", type: "boolean" },
        { path: "userName", type: "string" },
        { path: "rewardTitle", type: "string" },
        { path: "message", type: "string" },
      ],
    } satisfies DataShape);

    expect(parseDataShape(raw)).toEqual(JSON.parse(raw));
  });

  // Barkloader rejects these at install; a stale row must still not put a
  // blank line or a non-string under an alert.
  test("drops an empty summary and unusable details", () => {
    const raw = JSON.stringify({
      summary: "",
      details: ["{tier}", "", 3, null],
      fields: [{ path: "tier", type: "string" }],
    });

    expect(parseDataShape(raw)).toEqual({ details: ["{tier}"], fields: [{ path: "tier", type: "string" }] });
  });

  test("omits details when no entry is usable or the value is not an array", () => {
    const fields: DataShapeField[] = [{ path: "tier", type: "string" }];

    expect(parseDataShape(JSON.stringify({ summary: 7, details: ["", 1], fields }))).toEqual({ fields });
    expect(parseDataShape(JSON.stringify({ details: "{tier}", fields }))).toEqual({ fields });
  });
});
