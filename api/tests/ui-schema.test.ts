import { describe, expect, test } from "bun:test";
import {
  type ConfigField,
  type ConfigFieldOption,
  type DataShape,
  type DataShapeField,
  isFieldVisible,
  mergePinnedOptions,
  parseDataShape,
} from "@woofx3/api/ui-schema";

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

describe("mergePinnedOptions", () => {
  const origin = { value: "origin", label: "Where it came from" };
  const all = { value: "all", label: "Everywhere" };
  const twitch = { value: "twitch", label: "Twitch" };

  const cases: [string, ConfigFieldOption[], ConfigFieldOption[], ConfigFieldOption[]][] = [
    ["pinned first, fetched after", [origin, all], [twitch], [origin, all, twitch]],
    ["no fetched options", [origin, all], [], [origin, all]],
    ["no pinned options", [], [twitch], [twitch]],
    ["both empty", [], [], []],
    [
      "a fetched repeat of a pinned value is dropped, pinned label wins",
      [origin],
      [{ value: "origin", label: "Origin" }, twitch],
      [origin, twitch],
    ],
    ["a repeat within fetched keeps the first", [], [twitch, { value: "twitch", label: "Again" }], [twitch]],
  ];

  test.each(cases)("%s", (_name, pinned, fetched, expected) => {
    expect(mergePinnedOptions(pinned, fetched)).toEqual(expected);
  });

  test("does not mutate its inputs", () => {
    const pinned = [origin];
    const fetched = [twitch];
    mergePinnedOptions(pinned, fetched);
    expect(pinned).toEqual([origin]);
    expect(fetched).toEqual([twitch]);
  });
});

describe("isFieldVisible", () => {
  const plain: ConfigField = { id: "color", label: "Colour", type: "text" };
  const gated: ConfigField = {
    ...plain,
    visibleWhen: { field: "platform", oneOf: ["twitch", "kick"] },
  };

  const cases: [string, ConfigField, Record<string, unknown>, boolean][] = [
    ["no condition is always shown", plain, {}, true],
    ["sibling holds a listed value", gated, { platform: "twitch" }, true],
    ["sibling holds another listed value", gated, { platform: "kick" }, true],
    ["sibling holds an unlisted value", gated, { platform: "youtube" }, false],
    ["sibling is unset", gated, {}, false],
    ["sibling is not a string", gated, { platform: 1 }, false],
    ["sibling is null", gated, { platform: null }, false],
  ];

  test.each(cases)("%s", (_name, field, values, expected) => {
    expect(isFieldVisible(field, values)).toBe(expected);
  });
});
