import { afterEach, describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";

/** The minimum loadConfig requires; each test adds what it is about. */
const REQUIRED: Record<string, string> = {
  WOOFX3_DATABASE_PROXY_URL: "http://127.0.0.1:5555",
  WOOFX3_SCENE_MANAGER_URL: "http://127.0.0.1:9101",
  WOOFX3_BARKLOADER_WS_URL: "ws://127.0.0.1:9653/ws",
  WOOFX3_BARKLOADER_KEY: "test-key",
};

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

function withEnv(vars: Record<string, string>): void {
  delete process.env.WOOFX3_API_HOST;
  delete process.env.API_HOST;
  Object.assign(process.env, REQUIRED, vars);
}

describe("api listener", () => {
  test("binds loopback unless told otherwise", () => {
    withEnv({});

    expect(loadConfig().host).toBe("127.0.0.1");
  });

  test("binds the host WOOFX3_API_HOST names", () => {
    withEnv({ WOOFX3_API_HOST: "0.0.0.0" });

    expect(loadConfig().host).toBe("0.0.0.0");
  });
});
