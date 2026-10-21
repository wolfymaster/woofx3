import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPEN_REQUEST_GUARD_POLICY } from "@woofx3/common/http/request-guard";
import { WIDGET_HOST_SHIM_FILE } from "@woofx3/widget-host/frame";
import { loadConfig, type SceneManagerRuntimeConfig, validateConfig } from "../src/config";

// The shim is a build output, absent from a checkout that has not built it;
// validation checks it is there, so the config points at a directory that has one.
const publicDir = mkdtempSync(join(tmpdir(), "woofx3-config-test-"));
writeFileSync(join(publicDir, WIDGET_HOST_SHIM_FILE), "");

const valid: SceneManagerRuntimeConfig = {
  port: 9101,
  bindHost: "127.0.0.1",
  tokenSecret: "token-secret-0123456789abcdef0123456789",
  rootDir: "/tmp",
  publicDir,
  fontCacheDir: "/tmp/fonts",
  databaseProxyUrl: "http://127.0.0.1:9000",
  dbProxyToken: "db-proxy-token-0123456789abcdef0123456789",
  barkloaderUrl: "http://127.0.0.1:9653",
  mediaProxySecret: "media-secret-0123456789abcdef0123456789",
  requestGuard: OPEN_REQUEST_GUARD_POLICY,
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

describe("validateConfig secrets", () => {
  for (const [field, setting, value] of [
    ["tokenSecret", "sceneManagerTokenSecret", ""],
    ["tokenSecret", "sceneManagerTokenSecret", "CHANGE_ME"],
    ["tokenSecret", "sceneManagerTokenSecret", "short-secret"],
    ["mediaProxySecret", "barkloaderKey", ""],
    ["mediaProxySecret", "barkloaderKey", "CHANGE_ME"],
    ["mediaProxySecret", "barkloaderKey", "short-secret"],
    ["dbProxyToken", "dbProxyToken", ""],
    ["dbProxyToken", "dbProxyToken", "CHANGE_ME"],
    ["dbProxyToken", "dbProxyToken", "short-secret"],
  ] as const) {
    it(`refuses ${field} = "${value}"`, () => {
      expect(() => validateConfig({ ...valid, [field]: value })).toThrow(setting);
    });
  }
});

describe("message bus token", () => {
  // loadConfig writes the resolved config back into process.env, so every
  // variable is snapshotted and restored, not only the ones a test sets.
  const snapshot = { ...process.env };

  afterEach(() => {
    for (const name of Object.keys(process.env)) {
      if (!(name in snapshot)) {
        delete process.env[name];
      }
    }
    Object.assign(process.env, snapshot);
  });

  it("is the token WOOFX3_MESSAGEBUS_TOKEN gives", () => {
    process.env.WOOFX3_MESSAGEBUS_TOKEN = "s3cret";

    expect(loadConfig().nats.token).toBe("s3cret");
  });

  it("keeps a numeric token as text", () => {
    process.env.WOOFX3_MESSAGEBUS_TOKEN = "12345";

    expect(loadConfig().nats.token).toBe("12345");
  });

  it("is unset when nothing sets it", () => {
    delete process.env.WOOFX3_MESSAGEBUS_TOKEN;

    expect(loadConfig().nats.token).toBeUndefined();
  });
});
