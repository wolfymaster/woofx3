import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const PACKAGE_ROOT = resolve(import.meta.dir, "..");
const RELATIVE_IMPORT = /\bfrom\s+"(\.{1,2}\/[^"]+)"/g;

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
    for (const match of readFileSync(file, "utf8").matchAll(RELATIVE_IMPORT)) {
      const target = resolve(dirname(file), match[1]);
      pending.push(target.endsWith(".ts") ? target : `${target}.ts`);
    }
  }
  return [...seen].map((file) => relative(PACKAGE_ROOT, file)).sort();
}

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
