// The server (src/) and the overlay page (public/scene-manager/) share code
// only through contract/ and the shared libraries; neither imports the
// other's files.

import { describe, expect, it } from "bun:test";
import { Glob } from "bun";

const root = new URL("..", import.meta.url).pathname;

async function importsOf(pattern: string): Promise<Array<{ file: string; from: string }>> {
  const found: Array<{ file: string; from: string }> = [];
  for await (const file of new Glob(pattern).scan({ cwd: root })) {
    if (file.endsWith(".d.ts")) {
      continue;
    }
    const text = await Bun.file(`${root}${file}`).text();
    for (const match of text.matchAll(/^\s*(?:import|export)[^;]*?from\s+"([^"]+)"/gms)) {
      found.push({ file, from: match[1]! });
    }
  }
  return found;
}

describe("layering", () => {
  it("keeps the server out of the page's files", async () => {
    const offending = (await importsOf("src/**/*.ts")).filter(({ from }) => from.includes("public/"));
    expect(offending).toEqual([]);
  });

  it("keeps the page out of the server's files", async () => {
    const offending = (await importsOf("public/scene-manager/**/*.ts")).filter(({ from }) => /(^|\/)src\//.test(from));
    expect(offending).toEqual([]);
  });

  it("keeps contract/ free of both", async () => {
    const offending = (await importsOf("contract/**/*.ts")).filter(
      ({ from }) => from.includes("public/") || /(^|\/)src\//.test(from)
    );
    expect(offending).toEqual([]);
  });
});
