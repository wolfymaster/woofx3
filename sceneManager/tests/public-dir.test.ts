import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePublicDir } from "../src/config";

const created: string[] = [];

function dirWithPublic(): string {
  const dir = mkdtempSync(join(tmpdir(), "scene-public-"));
  created.push(dir);
  mkdirSync(join(dir, "public"));
  return dir;
}

function emptyDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "scene-empty-"));
  created.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolvePublicDir", () => {
  it("prefers the directory the executable runs from", () => {
    // What the image does: a compiled binary in /app, next to public/. Its
    // import.meta.dir points inside the bundle, where nothing exists.
    const execDir = dirWithPublic();

    expect(resolvePublicDir("/$bunfs/root", execDir)).toBe(join(execDir, "public"));
  });

  it("falls back to the source layout, where public/ sits beside src/", () => {
    const repo = dirWithPublic();

    expect(resolvePublicDir(join(repo, "src"), emptyDir())).toBe(join(repo, "public"));
  });

  it("uses public/ beside the module when that is what exists", () => {
    const moduleDir = dirWithPublic();

    expect(resolvePublicDir(moduleDir, emptyDir())).toBe(join(moduleDir, "public"));
  });
});
