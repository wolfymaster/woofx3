import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { type SceneManagerRuntimeConfig, validateConfig } from "../src/config";

const valid: SceneManagerRuntimeConfig = {
  port: 9101,
  bindHost: "127.0.0.1",
  tokenSecret: "secret",
  rootDir: "/tmp",
  publicDir: resolve(import.meta.dir, "../public"),
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
