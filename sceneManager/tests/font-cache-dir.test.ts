import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config";

describe("font cache directory", () => {
  let savedEnv: Record<string, string | undefined>;
  let rootDir: string;

  beforeEach(() => {
    savedEnv = { ...process.env };
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "woofx3-root-"));
    process.env.WOOFX3_ROOT = rootDir;
    process.env.WOOFX3_ROOT_PATH = rootDir;
    delete process.env.WOOFX3_CONFIG;
    delete process.env.WOOFX3_DATA_DIR;
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, savedEnv);
  });

  test("lives under the root path without a data directory", () => {
    expect(loadConfig().fontCacheDir).toBe(path.join(rootDir, "cache", "fonts"));
  });

  test("lives under the data directory when one is set", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "woofx3-data-"));
    process.env.WOOFX3_DATA_DIR = dataDir;
    expect(loadConfig().fontCacheDir).toBe(path.join(dataDir, "cache", "fonts"));
  });
});
