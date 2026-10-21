import { describe, expect, test } from "bun:test";
import { parseStoredManifest, parseStoredManifestJson, type StoredManifest } from "../src/stored-manifest";

function recordingLogger() {
  const warnings: Array<{ message: string; fields: Record<string, unknown> }> = [];
  const logger = {
    debug() {},
    info() {},
    error() {},
    warn(message: string, fields: Record<string, unknown>) {
      warnings.push({ message, fields });
    },
  } as any;
  return { logger, warnings };
}

const EMPTY: StoredManifest = {
  id: "",
  permissions: [],
  settings: [],
  resources: [],
  triggers: [],
  actions: [],
  widgets: [],
};

describe("parseStoredManifest", () => {
  const cases: Array<{ name: string; value: unknown; want: StoredManifest; dropped: number }> = [
    { name: "an empty object declares nothing", value: {}, want: EMPTY, dropped: 0 },
    { name: "a value that is not an object declares nothing", value: "counter", want: EMPTY, dropped: 1 },
    { name: "an array is not a manifest", value: [], want: EMPTY, dropped: 1 },
    {
      name: "lists that are not lists are empty",
      value: { resources: { kind: "x" }, actions: 3 },
      want: EMPTY,
      dropped: 0,
    },
    {
      name: "permissions are deduplicated, sorted and stripped of non-strings",
      value: { permissions: ["b", "a", "b", "", 4] },
      want: { ...EMPTY, permissions: ["a", "b"] },
      dropped: 0,
    },
    {
      name: "resources keep their declared text and optional icon and summary",
      value: {
        id: "m",
        resources: [
          {
            kind: "counter",
            name: "Counter",
            description: "d",
            icon: "hash",
            display: { summary: "value" },
            schema: [{ id: "a" }],
          },
        ],
      },
      want: {
        ...EMPTY,
        id: "m",
        resources: [
          {
            kind: "counter",
            name: "Counter",
            description: "d",
            icon: "hash",
            summaryPath: "value",
            schema: [{ id: "a" }],
          },
        ],
      },
      dropped: 0,
    },
    {
      name: "a sparse resource gets empty text and an empty schema",
      value: { resources: [{ kind: "timer", schema: "nope", display: "nope" }] },
      want: { ...EMPTY, resources: [{ kind: "timer", name: "", description: "", schema: [] }] },
      dropped: 0,
    },
    {
      name: "resources without a kind are dropped",
      value: { resources: [{ name: "No kind" }, null, { kind: "" }, { kind: "a" }] },
      want: { ...EMPTY, resources: [{ kind: "a", name: "", description: "", schema: [] }] },
      dropped: 3,
    },
    {
      name: "only an explicit true marks an action system-only",
      value: {
        actions: [{ id: "a", systemOnly: true, schema: [1] }, { id: "b", systemOnly: "yes" }, { systemOnly: true }],
      },
      want: {
        ...EMPTY,
        actions: [
          { id: "a", systemOnly: true, fields: [1] },
          { id: "b", systemOnly: false, fields: [] },
        ],
      },
      dropped: 1,
    },
    {
      name: "triggers read schema and widgets read settingsSchema",
      value: {
        triggers: [{ id: "t", schema: [1] }],
        widgets: [{ id: "w", settingsSchema: [2], schema: [3] }],
        settings: [4],
      },
      want: { ...EMPTY, triggers: [{ id: "t", fields: [1] }], widgets: [{ id: "w", fields: [2] }], settings: [4] },
      dropped: 0,
    },
  ];
  for (const { name, value, want, dropped } of cases) {
    test(name, () => {
      const { logger, warnings } = recordingLogger();

      expect(parseStoredManifest(value, logger, "mod")).toEqual(want);
      expect(warnings).toHaveLength(dropped);
      for (const warning of warnings) {
        expect(warning.fields.module).toBe("mod");
      }
    });
  }
});

describe("parseStoredManifestJson", () => {
  test("an absent manifest is null and not worth a warning", () => {
    const { logger, warnings } = recordingLogger();

    expect(parseStoredManifestJson(undefined, logger, "mod")).toBeNull();
    expect(parseStoredManifestJson("", logger, "mod")).toBeNull();
    expect(warnings).toEqual([]);
  });

  test("text that does not parse is null and logged", () => {
    const { logger, warnings } = recordingLogger();

    expect(parseStoredManifestJson("{nope", logger, "mod")).toBeNull();
    expect(warnings).toEqual([
      { message: expect.stringContaining("does not parse"), fields: expect.objectContaining({ module: "mod" }) },
    ]);
  });

  test("parses a manifest", () => {
    const { logger } = recordingLogger();

    expect(parseStoredManifestJson('{"id":"m"}', logger, "mod")).toEqual({ ...EMPTY, id: "m" });
  });
});
