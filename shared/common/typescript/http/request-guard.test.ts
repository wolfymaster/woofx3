import { describe, expect, test } from "bun:test";
import {
  ALLOWED_ORIGINS_SETTING,
  OPEN_REQUEST_GUARD_POLICY,
  parseRequestGuardPolicy,
  RequestGuard,
  type RequestGuardSettings,
} from "./request-guard";

/** Parses lists the way a service that allows `null` does, unless told otherwise. */
function parse(settings: Partial<RequestGuardSettings>) {
  return parseRequestGuardPolicy({
    allowedOriginsSetting: ALLOWED_ORIGINS_SETTING,
    opaqueOrigin: "allow",
    ...settings,
  });
}

function request(headers: Record<string, string>): Request {
  return new Request("http://engine.test/api", { headers });
}

function guardFor(allowedHosts?: string, allowedOrigins?: string): RequestGuard {
  return new RequestGuard(parse({ allowedHosts, allowedOrigins }));
}

describe("parseRequestGuardPolicy", () => {
  test("unset, empty and blank lists disable both checks", () => {
    expect(parse({})).toEqual(OPEN_REQUEST_GUARD_POLICY);
    expect(parse({ allowedHosts: "", allowedOrigins: "  " })).toEqual(OPEN_REQUEST_GUARD_POLICY);
  });

  test("a list that is set but names nothing is refused, not read as unset", () => {
    for (const value of [",", " , ", ",,", " ,\t, "]) {
      expect(() => parse({ allowedHosts: value })).toThrow("WOOFX3_ALLOWED_HOSTS");
      expect(() => parse({ allowedOrigins: value })).toThrow("WOOFX3_ALLOWED_ORIGINS");
      expect(() =>
        parse({ allowedOrigins: value, allowedOriginsSetting: "WOOFX3_SCENE_MANAGER_ALLOWED_ORIGINS" })
      ).toThrow("WOOFX3_SCENE_MANAGER_ALLOWED_ORIGINS");
    }
  });

  test("parses hosts with and without ports, IPv6 bracketed", () => {
    const policy = parse({ allowedHosts: "LocalHost, 127.0.0.1:8080 ,[::1]" });
    expect(policy.allowedHosts).toEqual([
      { hostname: "localhost", port: null },
      { hostname: "127.0.0.1", port: "8080" },
      { hostname: "[::1]", port: null },
    ]);
  });

  test("parses exact, any-port and opaque origins", () => {
    const policy = parse({
      allowedOrigins: "https://App.Example.com:443,http://localhost:*,null,http://127.0.0.1:5173/",
    });
    expect(policy.allowedOrigins).toEqual([
      { kind: "exact", origin: "https://app.example.com" },
      { kind: "anyPort", protocol: "http:", hostname: "localhost" },
      { kind: "opaque" },
      { kind: "exact", origin: "http://127.0.0.1:5173" },
    ]);
  });

  test("throws on malformed entries", () => {
    expect(() => parse({ allowedHosts: "http://localhost" })).toThrow("WOOFX3_ALLOWED_HOSTS");
    expect(() => parse({ allowedHosts: "*" })).toThrow("WOOFX3_ALLOWED_HOSTS");
    expect(() => parse({ allowedOrigins: "localhost:3000" })).toThrow("WOOFX3_ALLOWED_ORIGINS");
    expect(() => parse({ allowedOrigins: "https://a.example/path" })).toThrow("WOOFX3_ALLOWED_ORIGINS");
    expect(() => parse({ allowedOrigins: "*" })).toThrow("WOOFX3_ALLOWED_ORIGINS");
    expect(() => parse({ allowedOrigins: "http://localhost:3000:*" })).toThrow("WOOFX3_ALLOWED_ORIGINS");
  });
});

describe("parseRequestGuardPolicy opaque origin", () => {
  test("a service that refuses null fails on a list naming it, and only then", () => {
    expect(() => parse({ allowedOrigins: "https://app.example,null", opaqueOrigin: "refuse" })).toThrow(
      'WOOFX3_ALLOWED_ORIGINS: "null" is not allowed'
    );
    expect(parse({ allowedOrigins: "https://app.example", opaqueOrigin: "refuse" }).allowedOrigins).toEqual([
      { kind: "exact", origin: "https://app.example" },
    ]);
  });

  test("errors name the setting the list came from", () => {
    expect(() => parse({ allowedOrigins: "*", allowedOriginsSetting: "WOOFX3_SCENE_MANAGER_ALLOWED_ORIGINS" })).toThrow(
      "WOOFX3_SCENE_MANAGER_ALLOWED_ORIGINS"
    );
    expect(() =>
      parse({ allowedOrigins: false, allowedOriginsSetting: "WOOFX3_SCENE_MANAGER_ALLOWED_ORIGINS" })
    ).toThrow("WOOFX3_SCENE_MANAGER_ALLOWED_ORIGINS");
  });
});

describe("RequestGuard unset", () => {
  const guard = new RequestGuard(OPEN_REQUEST_GUARD_POLICY);

  test("allows any Host and Origin", () => {
    expect(guard.reject(request({ host: "evil.example", origin: "https://evil.example" }))).toBeNull();
  });

  test("answers CORS with * and no Vary", () => {
    expect(guard.corsOriginHeaders(request({ origin: "https://app.example" }))).toEqual({
      "Access-Control-Allow-Origin": "*",
    });
  });
});

describe("RequestGuard hosts", () => {
  const guard = guardFor("localhost,127.0.0.1:8080,[::1]");

  test("a bare name matches any port", () => {
    expect(guard.reject(request({ host: "localhost" }))).toBeNull();
    expect(guard.reject(request({ host: "LOCALHOST:9101" }))).toBeNull();
    expect(guard.reject(request({ host: "[::1]:8080" }))).toBeNull();
  });

  test("a name with a port matches only that port", () => {
    expect(guard.reject(request({ host: "127.0.0.1:8080" }))).toBeNull();
    expect(guard.reject(request({ host: "127.0.0.1:8081" }))?.status).toBe(421);
    expect(guard.reject(request({ host: "127.0.0.1" }))?.status).toBe(421);
  });

  test("an unknown or rebound name is 421", () => {
    expect(guard.reject(request({ host: "attacker.example:8080" }))?.status).toBe(421);
    expect(guard.reject(request({ host: "localhost.attacker.example" }))?.status).toBe(421);
  });

  test("hosts alone leave Origin unchecked and CORS at *", () => {
    expect(guard.reject(request({ host: "localhost", origin: "https://anything.example" }))).toBeNull();
    expect(guard.corsOriginHeaders(request({ origin: "https://anything.example" }))).toEqual({
      "Access-Control-Allow-Origin": "*",
    });
  });
});

describe("RequestGuard origins", () => {
  const guard = guardFor(undefined, "https://app.example,http://localhost:*");

  test("an absent Origin is allowed", () => {
    expect(guard.reject(request({}))).toBeNull();
  });

  test("a listed Origin is allowed, default port written or not", () => {
    expect(guard.reject(request({ origin: "https://app.example" }))).toBeNull();
    expect(guard.reject(request({ origin: "https://app.example:443" }))).toBeNull();
  });

  test("a wildcard port matches any port on that scheme and host", () => {
    expect(guard.reject(request({ origin: "http://localhost:5173" }))).toBeNull();
    expect(guard.reject(request({ origin: "http://localhost" }))).toBeNull();
    expect(guard.reject(request({ origin: "https://localhost:5173" }))?.status).toBe(403);
  });

  test("an unknown, differently-ported or opaque Origin is 403", () => {
    expect(guard.reject(request({ origin: "https://evil.example" }))?.status).toBe(403);
    expect(guard.reject(request({ origin: "https://app.example:8443" }))?.status).toBe(403);
    expect(guard.reject(request({ origin: "http://app.example" }))?.status).toBe(403);
    expect(guard.reject(request({ origin: "null" }))?.status).toBe(403);
  });

  test("null matches only when listed", () => {
    expect(guardFor(undefined, "null").reject(request({ origin: "null" }))).toBeNull();
  });

  test("CORS echoes the request origin with Vary", () => {
    expect(guard.corsOriginHeaders(request({ origin: "http://localhost:5173" }))).toEqual({
      "Access-Control-Allow-Origin": "http://localhost:5173",
      Vary: "Origin",
    });
    expect(guard.corsOriginHeaders(request({}))).toEqual({ Vary: "Origin" });
  });
});

describe("RequestGuard desktop webview origins", () => {
  const guard = guardFor(undefined, "tauri://localhost,http://tauri.localhost");

  test("tauri://localhost can be listed and matches case-insensitively", () => {
    expect(guard.reject(request({ origin: "tauri://localhost" }))).toBeNull();
    expect(guard.reject(request({ origin: "TAURI://LocalHost" }))).toBeNull();
  });

  test("http://tauri.localhost, the Windows webview origin, matches", () => {
    expect(guard.reject(request({ origin: "http://tauri.localhost" }))).toBeNull();
  });

  test("other non-special origins and null are not matched by accident", () => {
    expect(guard.reject(request({ origin: "null" }))?.status).toBe(403);
    expect(guard.reject(request({ origin: "tauri://evil" }))?.status).toBe(403);
    expect(guard.reject(request({ origin: "other://localhost" }))?.status).toBe(403);
    expect(guard.reject(request({ origin: "tauri://localhost:8080" }))?.status).toBe(403);
    expect(guard.reject(request({ origin: "file:///etc/passwd" }))?.status).toBe(403);
  });

  test("a non-special scheme takes a wildcard port", () => {
    const anyPort = guardFor(undefined, "tauri://localhost:*");
    expect(anyPort.reject(request({ origin: "tauri://localhost:1430" }))).toBeNull();
    expect(anyPort.reject(request({ origin: "tauri://localhost" }))).toBeNull();
  });

  test("an origin with no host cannot be listed", () => {
    expect(() => parse({ allowedOrigins: "file:///" })).toThrow("WOOFX3_ALLOWED_ORIGINS");
    expect(() => parse({ allowedOrigins: "mailto:a@b.example" })).toThrow("WOOFX3_ALLOWED_ORIGINS");
  });
});

describe("RequestGuard default ports", () => {
  test("a rule naming port 80 or 443 matches a Host without a port", () => {
    const guard = guardFor("engine.example:443,plain.example:80");
    expect(guard.reject(request({ host: "engine.example" }))).toBeNull();
    expect(guard.reject(request({ host: "engine.example:443" }))).toBeNull();
    expect(guard.reject(request({ host: "plain.example" }))).toBeNull();
    expect(guard.reject(request({ host: "engine.example:8443" }))?.status).toBe(421);
  });
});

describe("parseRequestGuardPolicy coerced values", () => {
  test("a value the config loader coerced to a boolean or number is refused", () => {
    expect(() => parse({ allowedHosts: true })).toThrow("WOOFX3_ALLOWED_HOSTS");
    expect(() => parse({ allowedHosts: 8080 })).toThrow("WOOFX3_ALLOWED_HOSTS");
    expect(() => parse({ allowedOrigins: false })).toThrow("WOOFX3_ALLOWED_ORIGINS");
  });
});

describe("RequestGuard hosts and origins", () => {
  test("Host is checked before Origin", () => {
    const guard = guardFor("localhost", "http://localhost:*");
    expect(guard.reject(request({ host: "evil.example", origin: "https://evil.example" }))?.status).toBe(421);
    expect(guard.reject(request({ host: "localhost", origin: "https://evil.example" }))?.status).toBe(403);
    expect(guard.reject(request({ host: "localhost:8080", origin: "http://localhost:3000" }))).toBeNull();
  });
});
