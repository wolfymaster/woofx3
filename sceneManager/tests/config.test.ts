import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SceneManagerRuntimeConfig, validateConfig } from "../src/config";
import { WIDGET_HOST_SHIM_FILE } from "../src/scene/frame-assembler";

// The shim is a build output, absent from a checkout that has not built it;
// validation checks it is there, so the config points at a directory that has one.
const publicDir = mkdtempSync(join(tmpdir(), "woofx3-config-test-"));
writeFileSync(join(publicDir, WIDGET_HOST_SHIM_FILE), "");

const valid: SceneManagerRuntimeConfig = {
  port: 9101,
  bindHost: "127.0.0.1",
  tokenSecret: "secret",
  rootDir: "/tmp",
  publicDir,
  fontCacheDir: "/tmp/fonts",
  databaseProxyUrl: "http://127.0.0.1:9000",
  barkloaderUrl: "http://127.0.0.1:9653",
  mediaProxySecret: "media-secret",
  obs: { host: "127.0.0.1", port: "4455" },
  nats: { url: "ws://127.0.0.1:4225", name: "scene-manager" },
};

describe("validateConfig", () => {
  it("accepts a complete config", () => {
    expect(() => validateConfig(valid)).not.toThrow();
  });

  it("refuses a missing or malformed db proxy URL, and a port that is not one", () => {
    for (const [field, config] of [
      ["databaseProxyUrl", { ...valid, databaseProxyUrl: "" }],
      ["databaseProxyUrl", { ...valid, databaseProxyUrl: "not a url" }],
      ["port", { ...valid, port: Number.NaN }],
      ["port", { ...valid, port: 70000 }],
    ] as const) {
      expect(() => validateConfig(config)).toThrow(field);
    }
  });
});
