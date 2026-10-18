import { afterEach, describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";

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

describe("message bus token", () => {
  test("is the token WOOFX3_MESSAGEBUS_TOKEN gives", () => {
    process.env.WOOFX3_MESSAGEBUS_TOKEN = "s3cret";

    expect(loadConfig().nats.token).toBe("s3cret");
  });

  test("keeps a numeric token as text", () => {
    process.env.WOOFX3_MESSAGEBUS_TOKEN = "12345";

    expect(loadConfig().nats.token).toBe("12345");
  });

  test("is unset when nothing sets it", () => {
    delete process.env.WOOFX3_MESSAGEBUS_TOKEN;
    delete process.env.MESSAGEBUS_TOKEN;

    expect(loadConfig().nats.token).toBeUndefined();
  });
});
