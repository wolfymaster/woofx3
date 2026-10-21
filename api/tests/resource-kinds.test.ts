import { describe, expect, test } from "bun:test";
import type { DeclaredResourceKind } from "@woofx3/api";
import { declaredResourceKinds, manifestResourceKinds } from "../src/resource-kinds";
import { parseStoredManifest } from "../src/stored-manifest";

const silent = { debug() {}, info() {}, warn() {}, error() {} } as any;

describe("manifestResourceKinds", () => {
  const cases: Array<{ name: string; manifest: unknown; expected: DeclaredResourceKind[] }> = [
    { name: "a manifest without resources declares none", manifest: { id: "m" }, expected: [] },
    { name: "resources that are not a list declare none", manifest: { resources: { kind: "x" } }, expected: [] },
    { name: "a manifest that is not an object declares none", manifest: "counter", expected: [] },
    {
      name: "a full entry keeps every field it declares",
      manifest: {
        resources: [
          {
            kind: "counter",
            name: "Counter",
            description: "Counts things",
            icon: "hash",
            schema: [{ id: "start", type: "number" }],
            display: { summary: "value" },
          },
        ],
      },
      expected: [
        {
          moduleName: "m",
          kind: "counter",
          name: "Counter",
          description: "Counts things",
          icon: "hash",
          schema: [{ id: "start", type: "number" }],
          summaryPath: "value",
        },
      ],
    },
    {
      name: "a sparse entry gets empty text and an empty form, and no icon or summary",
      manifest: { resources: [{ kind: "timer", schema: "nope", display: "nope" }] },
      expected: [{ moduleName: "m", kind: "timer", name: "", description: "", schema: [] }],
    },
    {
      name: "an entry without a kind is dropped, keeping manifest order for the rest",
      manifest: { resources: [{ kind: "b" }, { name: "No kind" }, null, { kind: "a" }] },
      expected: [
        { moduleName: "m", kind: "b", name: "", description: "", schema: [] },
        { moduleName: "m", kind: "a", name: "", description: "", schema: [] },
      ],
    },
  ];
  for (const { name, manifest, expected } of cases) {
    test(name, () => {
      expect(manifestResourceKinds("m", parseStoredManifest(manifest, silent, "m"))).toEqual(expected);
    });
  }
});

describe("declaredResourceKinds", () => {
  function logger() {
    const warnings: Array<{ message: string; fields: unknown }> = [];
    return {
      warnings,
      logger: {
        debug() {},
        info() {},
        error() {},
        warn(message: string, fields: unknown) {
          warnings.push({ message, fields });
        },
      } as any,
    };
  }

  const manifest = (body: unknown) => JSON.stringify(body);

  test("lists every module's kinds by module name, naming each module by its manifest id", () => {
    const { logger: log, warnings } = logger();
    const kinds = declaredResourceKinds(
      [
        {
          name: "Wheel Spinner",
          moduleId: "spinner",
          manifest: manifest({ id: "spinner", resources: [{ kind: "wheel" }] }),
        },
        {
          name: "Counter",
          moduleId: "counter",
          manifest: manifest({ id: "counter", resources: [{ kind: "counter" }, { kind: "tally" }] }),
        },
        { name: "No resources", moduleId: "plain", manifest: manifest({ id: "plain" }) },
      ],
      log
    );

    expect(kinds.map((k) => `${k.moduleName}:${k.kind}`)).toEqual([
      "counter:counter",
      "counter:tally",
      "spinner:wheel",
    ]);
    expect(warnings).toEqual([]);
  });

  test("falls back to the stored module id when the manifest names none", () => {
    const { logger: log } = logger();
    const [kind] = declaredResourceKinds(
      [{ name: "Legacy", moduleId: "legacy", manifest: manifest({ resources: [{ kind: "x" }] }) }],
      log
    );

    expect(kind?.moduleName).toBe("legacy");
  });

  test("leaves out a manifest that does not parse, says so, and keeps the other modules' kinds", () => {
    const { logger: log, warnings } = logger();
    const kinds = declaredResourceKinds(
      [
        { name: "Broken", moduleId: "broken", manifest: "{not json" },
        { name: "Empty", moduleId: "empty", manifest: "" },
        {
          name: "Counter",
          moduleId: "counter",
          manifest: manifest({ id: "counter", resources: [{ kind: "counter" }] }),
        },
      ],
      log
    );

    expect(kinds.map((k) => k.kind)).toEqual(["counter"]);
    expect(warnings).toEqual([
      { message: expect.stringContaining("does not parse"), fields: expect.objectContaining({ module: "Broken" }) },
    ]);
  });
});
