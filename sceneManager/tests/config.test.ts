import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPEN_REQUEST_GUARD_POLICY, RequestGuard } from "@woofx3/common/http/request-guard";
import { WIDGET_HOST_SHIM_FILE } from "@woofx3/widget-host/frame";
import { loadConfig, OBS_REFRESH_DEFAULTS, type SceneManagerRuntimeConfig, validateConfig } from "../src/config";

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
  barkloaderKey: "media-secret-0123456789abcdef0123456789",
  requestGuard: OPEN_REQUEST_GUARD_POLICY,
  obsRefresh: OBS_REFRESH_DEFAULTS,
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

describe("validateConfig obsRefresh", () => {
  for (const [name, obsRefresh] of [
    ["a zero request timeout", { ...OBS_REFRESH_DEFAULTS, requestTimeoutMs: 0 }],
    ["a non-numeric base", { ...OBS_REFRESH_DEFAULTS, retryBaseMs: Number.NaN }],
    ["a fractional max", { ...OBS_REFRESH_DEFAULTS, retryMaxMs: 10.5 }],
    ["a fractional warning threshold", { ...OBS_REFRESH_DEFAULTS, warnAfterAttempts: 2.5 }],
    ["a max below the base", { ...OBS_REFRESH_DEFAULTS, retryBaseMs: 5_000, retryMaxMs: 1_000 }],
  ] as const) {
    it(`refuses ${name}`, () => {
      expect(() => validateConfig({ ...valid, obsRefresh })).toThrow("obsRefresh");
    });
  }
});

describe("validateConfig secrets", () => {
  for (const [field, setting, value] of [
    ["tokenSecret", "sceneManagerTokenSecret", ""],
    ["tokenSecret", "sceneManagerTokenSecret", "CHANGE_ME"],
    ["tokenSecret", "sceneManagerTokenSecret", "short-secret"],
    ["barkloaderKey", "barkloaderKey", ""],
    ["barkloaderKey", "barkloaderKey", "CHANGE_ME"],
    ["barkloaderKey", "barkloaderKey", "short-secret"],
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

describe("request guard defaults", () => {
  const snapshot = { ...process.env };

  afterEach(() => {
    for (const name of Object.keys(process.env)) {
      if (!(name in snapshot)) {
        delete process.env[name];
      }
    }
    Object.assign(process.env, snapshot);
  });

  function guard(env: Record<string, string>): RequestGuard {
    delete process.env.WOOFX3_BEHIND_EDGE;
    delete process.env.WOOFX3_ALLOWED_HOSTS;
    delete process.env.WOOFX3_ALLOWED_ORIGINS;
    delete process.env.WOOFX3_SCENE_MANAGER_HOST;
    delete process.env.WOOFX3_SCENE_MANAGER_URL;
    Object.assign(process.env, env);
    return new RequestGuard(loadConfig().requestGuard);
  }

  function request(headers: Record<string, string>): Request {
    return new Request("http://127.0.0.1:9101/health", { headers });
  }

  it("admits widget frames and refuses a hostile page when nothing is set", () => {
    const g = guard({});
    expect(g.reject(request({ host: "127.0.0.1:9101", origin: "null" }))).toBeNull();
    expect(g.reject(request({ host: "127.0.0.1:9101", origin: "https://evil.example" }))?.status).toBe(403);
    expect(g.reject(request({ host: "rebound.attacker.example" }))?.status).toBe(421);
  });

  it("behind the edge, accepts the Host the proxy sends and the public page's own origin", () => {
    const g = guard({ WOOFX3_BEHIND_EDGE: "true", WOOFX3_SCENE_MANAGER_URL: "https://streamer.example" });
    expect(g.reject(request({ host: "eng-1.up.railway.app", origin: "https://streamer.example" }))).toBeNull();
    expect(g.reject(request({ host: "eng-1.up.railway.app", origin: "https://evil.example" }))?.status).toBe(403);
  });
});
