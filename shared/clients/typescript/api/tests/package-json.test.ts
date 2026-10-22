import { expect, test } from "bun:test";

const raw = await Bun.file(new URL("../package.json", import.meta.url)).text();

test("package.json declares each top-level key once, so no block silently replaces another", () => {
  const topLevelKeys = [...raw.matchAll(/^ {2}"([^"]+)":/gm)].map((match) => match[1]);
  expect(topLevelKeys).toEqual([...new Set(topLevelKeys)]);
});

test("package.json keeps both the test and the font generation scripts", () => {
  const { scripts } = JSON.parse(raw) as { scripts: Record<string, string> };
  expect(Object.keys(scripts).sort()).toEqual(["generate:google-fonts", "test"]);
});
