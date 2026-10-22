import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const PACKAGE_ROOT = resolve(import.meta.dir, "..");
const TRANSPILER = new Bun.Transpiler({ loader: "ts" });

// Bun's scanner finds every import that loads at runtime: static, side-effect,
// re-export and dynamic. It drops imports that are only types, because they
// never load, but a consumer's typecheck still has to resolve them. These two
// patterns cover exactly those: a type-only `import`/`export ... from "x"`
// (any `from` clause, which the scanner has already seen if it loads), and a
// type-level `import("x").T`.
const FROM_CLAUSE = /\bfrom\s+"([^"]+)"/g;
const IMPORT_CALL = /\bimport\(\s*"([^"]+)"\s*\)/g;

/** Every module specifier `source` names, at runtime or in its types, without duplicates. */
function importSpecifiers(source: string): string[] {
  const specifiers = new Set(TRANSPILER.scanImports(source).map((entry) => entry.path));
  for (const pattern of [FROM_CLAUSE, IMPORT_CALL]) {
    for (const match of source.matchAll(pattern)) {
      specifiers.add(match[1]);
    }
  }
  return [...specifiers].sort();
}

/** Every file `entry` reaches through relative imports, as package-relative paths. */
function reachableFiles(entry: string): string[] {
  const seen = new Set<string>();
  const pending = [resolve(PACKAGE_ROOT, entry)];
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    for (const specifier of importSpecifiers(readFileSync(file, "utf8"))) {
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
        continue;
      }
      const target = resolve(dirname(file), specifier);
      pending.push(target.endsWith(".ts") ? target : `${target}.ts`);
    }
  }
  return [...seen].map((file) => relative(PACKAGE_ROOT, file)).sort();
}

describe("importSpecifiers", () => {
  const cases: { name: string; source: string; specifiers: string[] }[] = [
    { name: "a named import", source: 'import { a } from "./named";\nconsole.log(a);', specifiers: ["./named"] },
    { name: "a side-effect import", source: 'import "./side";', specifiers: ["./side"] },
    {
      name: "a re-export",
      source: 'export * from "./all";\nexport { b } from "./some";',
      specifiers: ["./all", "./some"],
    },
    {
      name: "a dynamic import",
      source: 'const m = await import("./dynamic");\nconsole.log(m);',
      specifiers: ["./dynamic"],
    },
    { name: "a type-only import", source: 'import type { T } from "./types";\nlet t: T;', specifiers: ["./types"] },
    {
      name: "an inline type import",
      source: 'import { type T } from "./inline";\nlet t: T;',
      specifiers: ["./inline"],
    },
    { name: "a type-only re-export", source: 'export type { T } from "./retyped";', specifiers: ["./retyped"] },
    {
      name: "a type-level import",
      source: 'type T = import("./typelevel").T;\nlet t: T;',
      specifiers: ["./typelevel"],
    },
    {
      name: "a package import",
      source: 'import { RpcTarget } from "capnweb";\nconsole.log(RpcTarget);',
      specifiers: ["capnweb"],
    },
    { name: "no imports", source: "export const x = 1;", specifiers: [] },
  ];

  for (const { name, source, specifiers } of cases) {
    test(name, () => {
      expect(importSpecifiers(source)).toEqual(specifiers);
    });
  }
});

describe("@woofx3/api stays inside its own package", () => {
  const exportsMap = (
    JSON.parse(readFileSync(resolve(PACKAGE_ROOT, "package.json"), "utf8")) as {
      exports: Record<string, string>;
    }
  ).exports;
  // The scene editor sync core is built on the composition model by design
  // (see .github/workflows/api-checks.yml); every other entry point must load
  // without @woofx3/scene, so a consumer of the root package never needs it.
  const entries = Object.entries(exportsMap).filter(([subpath]) => !subpath.startsWith("./scene-editor"));

  for (const [subpath, file] of entries) {
    test(`${subpath} reaches only files of this package`, () => {
      const outside = reachableFiles(file).filter((path) => path.startsWith(".."));
      expect(outside).toEqual([]);
    });
  }
});
