import { describe, expect, test } from "bun:test";
import path from "node:path";
import { DATA_DIR_ENV, dataDir, resolveDataPath } from "./data-dir";

describe("data directory", () => {
  test("unset or blank means no data directory and paths are left alone", () => {
    for (const env of [{}, { [DATA_DIR_ENV]: "" }, { [DATA_DIR_ENV]: "  " }]) {
      expect(dataDir(env)).toBeUndefined();
      expect(resolveDataPath("./data/module-storage.db", env)).toBe("./data/module-storage.db");
    }
  });

  test("a relative path is anchored in the data directory", () => {
    const env = { [DATA_DIR_ENV]: "/var/lib/woofx3" };
    expect(resolveDataPath("./cache/fonts", env)).toBe(path.join("/var/lib/woofx3", "cache", "fonts"));
    expect(resolveDataPath("logs", env)).toBe(path.join("/var/lib/woofx3", "logs"));
  });

  test("an absolute path is kept", () => {
    const env = { [DATA_DIR_ENV]: "/var/lib/woofx3" };
    expect(resolveDataPath("/srv/woofx3/data.db", env)).toBe("/srv/woofx3/data.db");
  });

  test("a relative data directory is made absolute", () => {
    expect(dataDir({ [DATA_DIR_ENV]: "data" })).toBe(path.resolve("data"));
  });
});
