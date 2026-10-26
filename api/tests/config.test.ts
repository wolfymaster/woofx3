import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_COMPANION_REQUEST_TIMEOUT_MS, loadConfig, resolveCompanionRequestTimeoutMs } from "../src/config";

/** The minimum loadConfig requires; each test adds what it is about. */
const REQUIRED: Record<string, string> = {
  WOOFX3_DATABASE_PROXY_URL: "http://127.0.0.1:5555",
  WOOFX3_SCENE_MANAGER_URL: "http://127.0.0.1:9101",
  WOOFX3_BARKLOADER_WS_URL: "ws://127.0.0.1:9653/ws",
  WOOFX3_BARKLOADER_KEY: "test-barkloader-key-0123456789abcdef",
  WOOFX3_DB_PROXY_TOKEN: "test-db-proxy-token-0123456789abcdef",
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
  delete process.env.PORT;
  delete process.env.WOOFX3_BEHIND_EDGE;
  delete process.env.WOOFX3_REGISTRATION_MODE;
  delete process.env.WOOFX3_REGISTRATION_TOKEN;
  delete process.env.WOOFX3_ALLOWED_HOSTS;
  delete process.env.WOOFX3_ALLOWED_ORIGINS;
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

describe("secure defaults", () => {
  test("registration is first when neither a mode nor a token is set", () => {
    withEnv({});

    expect(loadConfig().registration).toEqual({ mode: "first", token: null });
  });

  test("open registration stops startup behind the edge", () => {
    withEnv({ WOOFX3_REGISTRATION_MODE: "open", WOOFX3_BEHIND_EDGE: "true" });

    expect(() => loadConfig()).toThrow("WOOFX3_REGISTRATION_MODE=open");
  });

  test("open registration stops startup on a non-loopback bind", () => {
    withEnv({ WOOFX3_REGISTRATION_MODE: "open", WOOFX3_API_HOST: "0.0.0.0" });

    expect(() => loadConfig()).toThrow("WOOFX3_REGISTRATION_MODE=open");
  });

  test("open registration is allowed on a loopback-only engine", () => {
    withEnv({ WOOFX3_REGISTRATION_MODE: "open" });

    expect(loadConfig().registration.mode).toBe("open");
  });

  test("a PORT exported by the parent shell does not change the exposure", () => {
    withEnv({ WOOFX3_REGISTRATION_MODE: "open", PORT: "3000" });

    expect(loadConfig().registration.mode).toBe("open");
  });

  test("a WOOFX3_BEHIND_EDGE that is not true or false stops startup", () => {
    withEnv({ WOOFX3_BEHIND_EDGE: "yes" });

    expect(() => loadConfig()).toThrow();
  });

  test("an unset request guard checks Origin, and Host on a loopback-only engine", () => {
    withEnv({});

    const { requestGuard } = loadConfig();
    expect(requestGuard.allowedOrigins).not.toBeNull();
    expect(requestGuard.allowedHosts).not.toBeNull();
  });

  test("behind the edge an unset request guard still checks Origin but not Host", () => {
    withEnv({ WOOFX3_BEHIND_EDGE: "true" });

    const { requestGuard } = loadConfig();
    expect(requestGuard.allowedOrigins).not.toBeNull();
    expect(requestGuard.allowedHosts).toBeNull();
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

describe("engine region", () => {
  test("is the region WOOFX3_ENGINE_REGION gives", () => {
    withEnv({ WOOFX3_ENGINE_REGION: "iad" });

    expect(loadConfig().engineRegion).toBe("iad");
  });

  test("is null when unset or blank", () => {
    delete process.env.WOOFX3_ENGINE_REGION;
    withEnv({});
    expect(loadConfig().engineRegion).toBeNull();

    withEnv({ WOOFX3_ENGINE_REGION: "  " });
    expect(loadConfig().engineRegion).toBeNull();
    delete process.env.WOOFX3_ENGINE_REGION;
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

describe("db proxy token", () => {
  for (const value of ["", "CHANGE_ME", "short-token"]) {
    test(`refuses "${value}"`, () => {
      withEnv({ WOOFX3_DB_PROXY_TOKEN: value });

      expect(() => loadConfig()).toThrow("dbProxyToken (WOOFX3_DB_PROXY_TOKEN)");
    });
  }

  test("keeps a usable token", () => {
    withEnv({});

    expect(loadConfig().dbProxyToken).toBe(REQUIRED.WOOFX3_DB_PROXY_TOKEN);
  });
});

describe("companion request timeout", () => {
  test("defaults when unset and reads WOOFX3_COMPANION_REQUEST_TIMEOUT_MS when set", () => {
    withEnv({});
    expect(loadConfig().companionRequestTimeoutMs).toBe(DEFAULT_COMPANION_REQUEST_TIMEOUT_MS);
    withEnv({ WOOFX3_COMPANION_REQUEST_TIMEOUT_MS: "7000" });
    expect(loadConfig().companionRequestTimeoutMs).toBe(7_000);
  });

  const valid: [unknown, number][] = [
    [undefined, DEFAULT_COMPANION_REQUEST_TIMEOUT_MS],
    ["", DEFAULT_COMPANION_REQUEST_TIMEOUT_MS],
    ["  ", DEFAULT_COMPANION_REQUEST_TIMEOUT_MS],
    [6_000, 6_000],
    ["4501", 4_501],
  ];
  for (const [value, expected] of valid) {
    test(`${JSON.stringify(value)} resolves to ${expected}`, () => {
      expect(resolveCompanionRequestTimeoutMs(value)).toBe(expected);
    });
  }

  for (const value of ["0", "-5", "1.5", "soon", 0, "250", "4500", 4_500]) {
    test(`${JSON.stringify(value)} stops startup`, () => {
      expect(() => resolveCompanionRequestTimeoutMs(value)).toThrow("WOOFX3_COMPANION_REQUEST_TIMEOUT_MS");
    });
  }
});
