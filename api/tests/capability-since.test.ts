import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ENGINE_CAPABILITIES, UNADVERTISED_ENGINE_CAPABILITIES } from "@woofx3/api";
import {
  CAPABILITIES,
  type Capabilities,
  fillTable,
  firstReleases,
  missingRows,
  parseCapabilities,
  parseTable,
  SINCE,
  unfilledIds,
} from "../../.github/scripts/capability-since.mjs";

const ROOT = join(import.meta.dir, "../..");

/** A capabilities.ts with the given keys and ids, and the unadvertised block when `unadvertised` is given. */
function capabilitiesSource(ids: Record<string, string>, unadvertised?: string[]): string {
  const entries = Object.entries(ids).map(([key, id]) => `  ${key}: "${id}",`);
  const source = [`export const ENGINE_CAPABILITIES = {`, ...entries, `} as const;`];
  if (unadvertised !== undefined) {
    source.push(
      `export const UNADVERTISED_ENGINE_CAPABILITIES: ReadonlySet<EngineCapability> = new Set<EngineCapability>([`,
      ...unadvertised.map((key) => `  ENGINE_CAPABILITIES.${key},`),
      `]);`
    );
  }
  return source.join("\n");
}

function capabilities(declared: string[], unadvertised: string[] = []): Capabilities {
  return { declared, advertised: new Set(declared.filter((id) => !unadvertised.includes(id))) };
}

describe("parseCapabilities", () => {
  test("reads the real capabilities.ts as ENGINE_CAPABILITIES declares it", () => {
    const parsed = parseCapabilities(readFileSync(join(ROOT, CAPABILITIES), "utf8"), { requireUnadvertised: true });
    const ids = Object.values(ENGINE_CAPABILITIES);
    expect([...parsed.declared].sort()).toEqual([...ids].sort());
    expect([...parsed.advertised].sort()).toEqual(ids.filter((id) => !UNADVERTISED_ENGINE_CAPABILITIES.has(id)).sort());
  });

  const cases: {
    name: string;
    source: string;
    requireUnadvertised: boolean;
    declared?: string[];
    advertised?: string[];
    error?: string;
  }[] = [
    {
      name: "splits out unadvertised ids",
      source: capabilitiesSource({ a: "x.a", b: "x.b" }, ["b"]),
      requireUnadvertised: true,
      declared: ["x.a", "x.b"],
      advertised: ["x.a"],
    },
    {
      name: "advertises every id of an older tag without the block",
      source: capabilitiesSource({ a: "x.a", b: "x.b" }),
      requireUnadvertised: false,
      declared: ["x.a", "x.b"],
      advertised: ["x.a", "x.b"],
    },
    {
      name: "requires the block in the current file",
      source: capabilitiesSource({ a: "x.a" }),
      requireUnadvertised: true,
      error: "no UNADVERTISED_ENGINE_CAPABILITIES block",
    },
    {
      name: "rejects an unadvertised key that declares nothing",
      source: capabilitiesSource({ a: "x.a" }, ["gone"]),
      requireUnadvertised: false,
      error: "names gone",
    },
    {
      name: "rejects a source with no readable ids",
      source: `export const ENGINE_CAPABILITIES = { a: 'x.a' } as const;`,
      requireUnadvertised: false,
      error: "declares no capability ids",
    },
  ];
  for (const { name, source, requireUnadvertised, declared, advertised, error } of cases) {
    test(name, () => {
      if (error !== undefined) {
        expect(() => parseCapabilities(source, { requireUnadvertised })).toThrow(error);
        return;
      }
      const parsed = parseCapabilities(source, { requireUnadvertised });
      expect(parsed.declared).toEqual(declared ?? []);
      expect([...parsed.advertised]).toEqual(advertised ?? []);
    });
  }
});

describe("parseTable", () => {
  const cases: { name: string; line: string; since?: string; feature?: string; error?: string }[] = [
    { name: "a three-cell row", line: "| `x.a` | v1.2.3 | Feature |", since: "v1.2.3", feature: "Feature" },
    { name: "an unreleased row", line: "| `x.a` | unreleased | Feature |", since: "unreleased", feature: "Feature" },
    { name: "an empty Since cell", line: "| `x.a` |  | Feature |", since: "", feature: "Feature" },
    { name: "a row without a Since cell", line: "| `x.a` | Feature |", since: "", feature: "Feature" },
    { name: "an escaped pipe in a feature", line: "| `x.a` | v1.0.0 | a \\| b |", since: "v1.0.0", feature: "a \\| b" },
    { name: "a CRLF line ending", line: "| `x.a` | v1.0.0 | Feature |\r", since: "v1.0.0", feature: "Feature" },
    { name: "a malformed Since", line: "| `x.a` | TBD | Feature |", error: 'Since is "TBD"' },
    { name: "a partial version", line: "| `x.a` | v0.4 | Feature |", error: 'Since is "v0.4"' },
    { name: "an unescaped pipe in a feature", line: "| `x.a` | v1.0.0 | a | b |", error: "has 4 cells" },
  ];
  for (const { name, line, since, feature, error } of cases) {
    test(name, () => {
      const doc = `| Id | Since | Feature |\n|---|---|---|\n${line}\n`;
      if (error !== undefined) {
        expect(() => parseTable(doc)).toThrow(`engine-capabilities.md:3: the x.a row`);
        expect(() => parseTable(doc)).toThrow(error);
        return;
      }
      expect(parseTable(doc).rows.get("x.a")).toEqual({ index: 2, since: since ?? "", feature: feature ?? "" });
    });
  }
});

describe("firstReleases", () => {
  const sources: Record<string, string> = {
    "v0.2.0": capabilitiesSource({ a: "x.a", b: "x.b" }, ["b"]),
    "v0.3.0-rc.1": capabilitiesSource({ a: "x.a", b: "x.b" }),
    "v0.3.0": capabilitiesSource({ a: "x.a", b: "x.b" }),
  };
  const read = (tag: string) => sources[tag];

  test("gives each id the first release tag advertising it", () => {
    const tags = ["v0.1.0", "v0.2.0", "v0.3.0-rc.1", "v0.3.0"];
    expect(firstReleases(["x.a", "x.b"], tags, read)).toEqual(
      new Map([
        ["x.a", "v0.2.0"],
        ["x.b", "v0.3.0"],
      ])
    );
  });

  test("leaves out ids no release advertised", () => {
    expect(firstReleases(["x.b", "x.c"], ["v0.1.0", "v0.2.0"], read)).toEqual(new Map());
  });
});

describe("fillTable", () => {
  const doc = [
    "| `x.recorded` | v0.1.0 | Recorded |",
    "| `x.empty` |  | Empty |",
    "| `x.legacy` | Legacy |",
    "| `x.unreleased` | unreleased | Unreleased |",
    "| `x.hidden` | unreleased | Hidden |",
    "",
  ].join("\n");
  const current = capabilities(["x.recorded", "x.empty", "x.legacy", "x.unreleased", "x.hidden"], ["x.hidden"]);
  const table = parseTable(doc);

  test("fills only empty, absent and unreleased cells", () => {
    expect(unfilledIds(current, table)).toEqual(["x.empty", "x.legacy", "x.unreleased", "x.hidden"]);
  });

  test("records found releases and leaves the rest unreleased", () => {
    const found = new Map([["x.empty", "v0.2.0"]]);
    expect(fillTable(current, table, found).split("\n")).toEqual([
      "| `x.recorded` | v0.1.0 | Recorded |",
      "| `x.empty` | v0.2.0 | Empty |",
      "| `x.legacy` | unreleased | Legacy |",
      "| `x.unreleased` | unreleased | Unreleased |",
      "| `x.hidden` | unreleased | Hidden |",
      "",
    ]);
  });

  test("gives the tag being released only to advertised ids", () => {
    expect(fillTable(current, table, new Map(), "v0.3.0").split("\n")).toEqual([
      "| `x.recorded` | v0.1.0 | Recorded |",
      "| `x.empty` | v0.3.0 | Empty |",
      "| `x.legacy` | v0.3.0 | Legacy |",
      "| `x.unreleased` | v0.3.0 | Unreleased |",
      "| `x.hidden` | unreleased | Hidden |",
      "",
    ]);
  });

  test("changes nothing once every value is recorded", () => {
    const filled = fillTable(current, table, new Map(), "v0.3.0");
    expect(fillTable(current, parseTable(filled), new Map(), "v0.4.0")).toBe(filled);
  });

  test("keeps a CRLF line ending", () => {
    const crlf = parseTable("| `x.empty` |  | Empty |\r\n");
    expect(fillTable(capabilities(["x.empty"]), crlf, new Map([["x.empty", "v0.2.0"]]))).toBe(
      "| `x.empty` | v0.2.0 | Empty |\r\n"
    );
  });

  test("reports declared ids without a row", () => {
    expect(missingRows(capabilities(["x.recorded", "x.new"]), table)).toEqual(["x.new"]);
  });
});

test("SINCE accepts a release tag or unreleased", () => {
  for (const value of ["v0.1.0", "v12.30.4", "unreleased"]) {
    expect(value).toMatch(SINCE);
  }
  for (const value of ["", "v0.1", "0.1.0", "v0.1.0-rc.1", "TBD", "Unreleased"]) {
    expect(value).not.toMatch(SINCE);
  }
});
