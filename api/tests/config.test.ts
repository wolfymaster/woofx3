import { afterEach, describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";

/** The minimum loadConfig requires; each test adds what it is about. */
const REQUIRED: Record<string, string> = {
  WOOFX3_DATABASE_PROXY_URL: "http://127.0.0.1:5555",
  WOOFX3_SCENE_MANAGER_URL: "http://127.0.0.1:9101",
  WOOFX3_BARKLOADER_WS_URL: "ws://127.0.0.1:9653/ws",
  WOOFX3_BARKLOADER_KEY: "test-barkloader-key-0123456789abcdef",
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

describe("engine name", () => {
  test("is the name WOOFX3_ENGINE_NAME gives", () => {
    withEnv({ WOOFX3_ENGINE_NAME: "eng-0a1b2c3d" });

    expect(loadConfig().engineName).toBe("eng-0a1b2c3d");
  });

  test("is null when unset", () => {
    delete process.env.WOOFX3_ENGINE_NAME;
    withEnv({});

    expect(loadConfig().engineName).toBeNull();
  });
});

describe("engine hosting", () => {
  test("is null when WOOFX3_HOSTING is unset or blank", () => {
    withEnv({});
    delete process.env.WOOFX3_HOSTING;
    expect(loadConfig().hosting).toBeNull();

    withEnv({ WOOFX3_HOSTING: " " });
    expect(loadConfig().hosting).toBeNull();
  });

  test("is the hosting WOOFX3_HOSTING names", () => {
    for (const hosting of ["managed", "self", "local"]) {
      withEnv({ WOOFX3_HOSTING: hosting });
      expect(loadConfig().hosting).toBe(hosting as never);
    }
  });

  test("refuses any other value", () => {
    withEnv({ WOOFX3_HOSTING: "cloud" });
    expect(() => loadConfig()).toThrow("WOOFX3_HOSTING");
  });
});

describe("message bus token", () => {
  test("is the token WOOFX3_MESSAGEBUS_TOKEN gives", () => {
    withEnv({ WOOFX3_MESSAGEBUS_TOKEN: "s3cret" });

    expect(loadConfig().nats.token).toBe("s3cret");
  });

  test("keeps a numeric token as text", () => {
    withEnv({ WOOFX3_MESSAGEBUS_TOKEN: "12345" });

    expect(loadConfig().nats.token).toBe("12345");
  });

  test("is unset when nothing sets it", () => {
    delete process.env.WOOFX3_MESSAGEBUS_TOKEN;
    delete process.env.MESSAGEBUS_TOKEN;
    withEnv({});

    expect(loadConfig().nats.token).toBeUndefined();
  });
});

describe("public Twitch app", () => {
  test("is the client id WOOFX3_TWITCH_PUBLIC_CLIENT_ID gives, apart from the confidential app's", () => {
    withEnv({ WOOFX3_TWITCH_PUBLIC_CLIENT_ID: "abc123publicapp", WOOFX3_TWITCH_CLIENT_ID: "confidential" });

    expect(loadConfig().twitchPublicClientId).toBe("abc123publicapp");
  });

  test("keeps an all-digit client id as text", () => {
    withEnv({ WOOFX3_TWITCH_PUBLIC_CLIENT_ID: "12345" });

    expect(loadConfig().twitchPublicClientId).toBe("12345");
  });

  test("is null when unset or blank", () => {
    delete process.env.WOOFX3_TWITCH_PUBLIC_CLIENT_ID;
    withEnv({});
    expect(loadConfig().twitchPublicClientId).toBeNull();

    withEnv({ WOOFX3_TWITCH_PUBLIC_CLIENT_ID: " " });
    expect(loadConfig().twitchPublicClientId).toBeNull();
  });

  test("refuses a value that is not a client id", () => {
    withEnv({ WOOFX3_TWITCH_PUBLIC_CLIENT_ID: "abc&client_secret=x" });
    expect(() => loadConfig()).toThrow("WOOFX3_TWITCH_PUBLIC_CLIENT_ID");
  });
});

describe("confidential Twitch app", () => {
  test("is the client id WOOFX3_TWITCH_CLIENT_ID gives", () => {
    withEnv({ WOOFX3_TWITCH_CLIENT_ID: "confidential", WOOFX3_TWITCH_PUBLIC_CLIENT_ID: "abc123publicapp" });

    expect(loadConfig().twitchClientId).toBe("confidential");
  });

  test("is null when unset or blank", () => {
    delete process.env.WOOFX3_TWITCH_CLIENT_ID;
    withEnv({});
    expect(loadConfig().twitchClientId).toBeNull();

    withEnv({ WOOFX3_TWITCH_CLIENT_ID: " " });
    expect(loadConfig().twitchClientId).toBeNull();
  });

  test("refuses a value that is not a client id", () => {
    withEnv({ WOOFX3_TWITCH_CLIENT_ID: "abc def" });
    expect(() => loadConfig()).toThrow("WOOFX3_TWITCH_CLIENT_ID");
  });
});

describe("barkloader key", () => {
  for (const value of ["", "CHANGE_ME", "short-key"]) {
    test(`refuses "${value}"`, () => {
      withEnv({ WOOFX3_BARKLOADER_KEY: value });

      expect(() => loadConfig()).toThrow("barkloaderKey (WOOFX3_BARKLOADER_KEY)");
    });
  }
});
