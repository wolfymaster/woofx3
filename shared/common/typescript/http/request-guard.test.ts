import { describe, expect, test } from "bun:test";
import {
  ALLOWED_ORIGINS_SETTING,
  comparableOriginOf,
  DEFAULT_ALLOWED_ORIGINS,
  describeRequestGuardPolicy,
  isLoopbackHostname,
  OPEN_REQUEST_GUARD_POLICY,
  parseRequestGuardPolicy,
  parseUiOrigins,
  RequestGuard,
  type RequestGuardSettings,
  resolveExposure,
} from "./request-guard";

function request(headers: Record<string, string>): Request {
  return new Request("http://engine.test/api", { headers });
}

/** How a service that allows `null` names its origin list, unless a test says otherwise. */
const ORIGIN_LIST = { allowedOriginsSetting: ALLOWED_ORIGINS_SETTING, opaqueOrigin: "allow" } as const;

/** A network-exposed service with no URLs of its own, so only the given settings apply. */
function policyFor(settings: Partial<RequestGuardSettings>) {
  return parseRequestGuardPolicy({
    ...ORIGIN_LIST,
    exposure: "network",
    ownUrls: [],
    extraDefaultOrigins: [],
    ...settings,
  });
}

function guardFor(allowedHosts = "*", allowedOrigins = "*"): RequestGuard {
  return new RequestGuard(policyFor({ allowedHosts, allowedOrigins }));
}

describe("parseRequestGuardPolicy", () => {
  test("* disables both checks", () => {
    expect(policyFor({ allowedHosts: "*", allowedOrigins: " * " })).toEqual(OPEN_REQUEST_GUARD_POLICY);
  });

  test("* must be the only entry", () => {
    expect(() => policyFor({ allowedHosts: "*,localhost" })).toThrow("WOOFX3_ALLOWED_HOSTS");
    expect(() => policyFor({ allowedOrigins: "https://a.example,*" })).toThrow("WOOFX3_ALLOWED_ORIGINS");
  });

  test("parses hosts with and without ports, IPv6 bracketed", () => {
    const policy = policyFor({ allowedHosts: "LocalHost, 127.0.0.1:8080 ,[::1]" });
    expect(policy.allowedHosts).toEqual([
      { hostname: "localhost", port: null },
      { hostname: "127.0.0.1", port: "8080" },
      { hostname: "[::1]", port: null },
    ]);
  });

  test("parses exact, any-port and opaque origins", () => {
    const policy = policyFor({
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
    expect(() => policyFor({ allowedHosts: "http://localhost" })).toThrow("WOOFX3_ALLOWED_HOSTS");
    expect(() => policyFor({ allowedOrigins: "localhost:3000" })).toThrow("WOOFX3_ALLOWED_ORIGINS");
    expect(() => policyFor({ allowedOrigins: "https://a.example/path" })).toThrow("WOOFX3_ALLOWED_ORIGINS");
    expect(() => policyFor({ allowedOrigins: "http://localhost:3000:*" })).toThrow("WOOFX3_ALLOWED_ORIGINS");
  });
});

describe("RequestGuard open", () => {
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

  test("origins set to * leave Origin unchecked and CORS at *", () => {
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
    expect(() => policyFor({ allowedOrigins: "file:///" })).toThrow("WOOFX3_ALLOWED_ORIGINS");
    expect(() => policyFor({ allowedOrigins: "mailto:a@b.example" })).toThrow("WOOFX3_ALLOWED_ORIGINS");
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
    expect(() => policyFor({ allowedHosts: true })).toThrow("WOOFX3_ALLOWED_HOSTS");
    expect(() => policyFor({ allowedHosts: 8080 })).toThrow("WOOFX3_ALLOWED_HOSTS");
    expect(() => policyFor({ allowedOrigins: false })).toThrow("WOOFX3_ALLOWED_ORIGINS");
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

describe("parseRequestGuardPolicy defaults", () => {
  const loopback = { ...ORIGIN_LIST, exposure: "loopback", ownUrls: [], extraDefaultOrigins: [] } as const;

  test("unset and blank origins default to the loopback dev servers and the desktop webview", () => {
    expect(parseRequestGuardPolicy(loopback).allowedOrigins).toEqual(
      policyFor({ allowedOrigins: DEFAULT_ALLOWED_ORIGINS.join(",") }).allowedOrigins
    );
    expect(parseRequestGuardPolicy({ ...loopback, allowedOrigins: " , " }).allowedOrigins).toEqual(
      parseRequestGuardPolicy(loopback).allowedOrigins
    );
  });

  test("unset origins refuse a hostile page and admit local dev, the webview and callers with no Origin", () => {
    const guard = new RequestGuard(parseRequestGuardPolicy(loopback));
    expect(guard.reject(request({ host: "127.0.0.1:5050", origin: "https://evil.example" }))?.status).toBe(403);
    expect(guard.reject(request({ host: "127.0.0.1:5050", origin: "http://localhost:5173" }))).toBeNull();
    expect(guard.reject(request({ host: "127.0.0.1:5050", origin: "tauri://localhost" }))).toBeNull();
    expect(guard.reject(request({ host: "127.0.0.1:5050", origin: "http://tauri.localhost" }))).toBeNull();
    expect(guard.reject(request({ host: "127.0.0.1:5050" }))).toBeNull();
    expect(guard.corsOriginHeaders(request({ origin: "http://localhost:5173" }))).toEqual({
      "Access-Control-Allow-Origin": "http://localhost:5173",
      Vary: "Origin",
    });
  });

  test("a loopback-only service checks Host by default and refuses a rebound name", () => {
    const guard = new RequestGuard(parseRequestGuardPolicy(loopback));
    expect(guard.reject(request({ host: "localhost:5050" }))).toBeNull();
    expect(guard.reject(request({ host: "127.0.0.1:9101" }))).toBeNull();
    expect(guard.reject(request({ host: "[::1]:5050" }))).toBeNull();
    expect(guard.reject(request({ host: "rebound.attacker.example:5050" }))?.status).toBe(421);
  });

  test("a network-exposed service leaves Host unchecked by default but still checks Origin", () => {
    const guard = new RequestGuard(policyFor({}));
    expect(guard.reject(request({ host: "eng-1.up.railway.app" }))).toBeNull();
    expect(guard.reject(request({ host: "eng-1.up.railway.app", origin: "https://evil.example" }))?.status).toBe(403);
  });

  test("the service's own URLs join both default lists", () => {
    const guard = new RequestGuard(
      parseRequestGuardPolicy({ ...loopback, ownUrls: ["https://streamer.example", "http://127.0.0.1:5050"] })
    );
    expect(guard.reject(request({ host: "streamer.example", origin: "https://streamer.example" }))).toBeNull();
    expect(guard.reject(request({ host: "other.example" }))?.status).toBe(421);
  });

  test("extra default origins are added, for sceneManager's widget frames", () => {
    const guard = new RequestGuard(parseRequestGuardPolicy({ ...loopback, extraDefaultOrigins: ["null"] }));
    expect(guard.reject(request({ host: "127.0.0.1", origin: "null" }))).toBeNull();
    expect(
      new RequestGuard(parseRequestGuardPolicy(loopback)).reject(request({ host: "127.0.0.1", origin: "null" }))?.status
    ).toBe(403);
  });

  test("an explicit list replaces the defaults", () => {
    const guard = new RequestGuard(
      parseRequestGuardPolicy({ ...loopback, allowedHosts: "engine.example", allowedOrigins: "https://app.example" })
    );
    expect(guard.reject(request({ host: "localhost" }))?.status).toBe(421);
    expect(guard.reject(request({ host: "engine.example", origin: "http://localhost:5173" }))?.status).toBe(403);
  });

  test("a malformed own URL fails at startup", () => {
    expect(() => parseRequestGuardPolicy({ ...loopback, ownUrls: ["not a url"] })).toThrow("own URL");
  });
});

describe("RequestGuard subdomain wildcard origins", () => {
  const guard = guardFor("*", "https://*.preview.example");

  test("matches any subdomain at any depth on the listed scheme and port", () => {
    expect(guard.reject(request({ origin: "https://pr-12-ui.preview.example" }))).toBeNull();
    expect(guard.reject(request({ origin: "https://a.b.preview.example" }))).toBeNull();
    expect(guard.reject(request({ origin: "https://PR-12-UI.preview.example:443" }))).toBeNull();
  });

  test("does not match the domain itself, a lookalike, another scheme or another port", () => {
    for (const origin of [
      "https://preview.example",
      "https://evilpreview.example",
      "https://preview.example.evil.example",
      "http://pr-12-ui.preview.example",
      "https://pr-12-ui.preview.example:8443",
      "null",
    ]) {
      expect(guard.reject(request({ origin }))?.status).toBe(403);
    }
  });

  test("a port in the entry matches only that port", () => {
    const ported = guardFor("*", "http://*.dev.example:5173");
    expect(ported.reject(request({ origin: "http://ui.dev.example:5173" }))).toBeNull();
    expect(ported.reject(request({ origin: "http://ui.dev.example" }))?.status).toBe(403);
  });

  test("is described as written", () => {
    expect(describeRequestGuardPolicy(policyFor({ allowedOrigins: "https://*.Preview.Example:8443" }))).toEqual({
      allowedHosts: "*",
      allowedOrigins: "https://*.preview.example:8443",
    });
  });

  test("throws on a wildcard over a top-level domain, an address, a non-web scheme or with :*", () => {
    for (const entry of [
      "https://*.example",
      "https://*.10.0.0.1",
      "https://*.",
      "tauri://*.localhost.example",
      "https://*.preview.example:*",
      "https://*.preview.example/path",
      "https://ui.*.example",
    ]) {
      expect(() => policyFor({ allowedOrigins: entry })).toThrow("WOOFX3_ALLOWED_ORIGINS");
    }
  });
});

describe("parseUiOrigins", () => {
  test("unset or blank is no origin", () => {
    expect(parseUiOrigins(undefined)).toEqual([]);
    expect(parseUiOrigins("")).toEqual([]);
    expect(parseUiOrigins(" , ")).toEqual([]);
  });

  test("returns each listed origin, trimmed", () => {
    expect(parseUiOrigins("https://woofx3.tv")).toEqual(["https://woofx3.tv"]);
    expect(parseUiOrigins(" https://woofx3.tv , https://*.preview.example ")).toEqual([
      "https://woofx3.tv",
      "https://*.preview.example",
    ]);
  });

  test("a malformed entry, *, null or a non-list stops startup naming the setting", () => {
    for (const value of [
      "woofx3.tv",
      "https://woofx3.tv/dashboard",
      "https://user@woofx3.tv",
      "https://*.tv",
      "*",
      "null",
      "https://woofx3.tv,null",
      true,
      8080,
    ]) {
      expect(() => parseUiOrigins(value)).toThrow("WOOFX3_UI_URL");
    }
  });

  test("its origins join the defaults as extra default origins", () => {
    const guard = new RequestGuard(
      parseRequestGuardPolicy({
        ...ORIGIN_LIST,
        exposure: "network",
        ownUrls: ["https://streamer.woofx3.tv"],
        extraDefaultOrigins: parseUiOrigins("https://woofx3.tv"),
      })
    );
    expect(guard.reject(request({ origin: "https://woofx3.tv" }))).toBeNull();
    expect(guard.reject(request({ origin: "http://localhost:5173" }))).toBeNull();
    expect(guard.reject(request({ origin: "https://evil.example" }))?.status).toBe(403);
  });
});

describe("resolveExposure", () => {
  test("loopback binds with no edge are loopback-only", () => {
    expect(resolveExposure("127.0.0.1", false)).toBe("loopback");
    expect(resolveExposure("localhost", false)).toBe("loopback");
    expect(resolveExposure("::1", false)).toBe("loopback");
  });

  test("a non-loopback bind or the edge is network", () => {
    expect(resolveExposure("0.0.0.0", false)).toBe("network");
    expect(resolveExposure("192.168.1.10", false)).toBe("network");
    expect(resolveExposure("127.0.0.1", true)).toBe("network");
  });

  test("isLoopbackHostname", () => {
    expect(isLoopbackHostname("127.0.0.2")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("LOCALHOST.")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1.evil.example")).toBe(false);
    expect(isLoopbackHostname("::")).toBe(false);
  });
});

describe("describeRequestGuardPolicy", () => {
  test("lists the resolved loopback defaults", () => {
    const policy = parseRequestGuardPolicy({
      ...ORIGIN_LIST,
      exposure: "loopback",
      ownUrls: ["https://streamer.example"],
      extraDefaultOrigins: ["null"],
    });

    expect(describeRequestGuardPolicy(policy)).toEqual({
      allowedHosts: "localhost,127.0.0.1,[::1],streamer.example",
      allowedOrigins:
        "http://localhost:*,http://127.0.0.1:*,tauri://localhost,http://tauri.localhost,null,https://streamer.example",
    });
  });

  test("shows an unchecked list as *", () => {
    expect(describeRequestGuardPolicy(policyFor({ allowedOrigins: "*" }))).toEqual({
      allowedHosts: "*",
      allowedOrigins: "*",
    });
  });
});

describe("parseRequestGuardPolicy opaque origin", () => {
  test("a service that refuses null fails on a list naming it, and only then", () => {
    expect(() => policyFor({ allowedOrigins: "https://app.example,null", opaqueOrigin: "refuse" })).toThrow(
      'WOOFX3_ALLOWED_ORIGINS: "null" is not allowed'
    );
    expect(policyFor({ allowedOrigins: "https://app.example", opaqueOrigin: "refuse" }).allowedOrigins).toEqual([
      { kind: "exact", origin: "https://app.example" },
    ]);
  });

  test("a service that refuses null fails on default origins naming it", () => {
    expect(() => policyFor({ extraDefaultOrigins: ["null"], opaqueOrigin: "refuse" })).toThrow('"null" is not allowed');
  });

  test("errors name the setting the list came from", () => {
    expect(() =>
      policyFor({
        allowedOrigins: "*,https://a.example",
        allowedOriginsSetting: "WOOFX3_SCENE_MANAGER_ALLOWED_ORIGINS",
      })
    ).toThrow("WOOFX3_SCENE_MANAGER_ALLOWED_ORIGINS");
    expect(() =>
      policyFor({ allowedOrigins: "localhost:3000", allowedOriginsSetting: "WOOFX3_SCENE_MANAGER_ALLOWED_ORIGINS" })
    ).toThrow("WOOFX3_SCENE_MANAGER_ALLOWED_ORIGINS");
    expect(() =>
      policyFor({ allowedOrigins: false, allowedOriginsSetting: "WOOFX3_SCENE_MANAGER_ALLOWED_ORIGINS" })
    ).toThrow("WOOFX3_SCENE_MANAGER_ALLOWED_ORIGINS");
  });
});

describe("RequestGuard.rejectOpaqueOrigin", () => {
  test("refuses Origin: null when origins are checked, null listed or not", () => {
    for (const origins of ["https://app.example,null", "https://app.example"]) {
      expect(guardFor("*", origins).rejectOpaqueOrigin(request({ origin: "null" }))?.status).toBe(403);
    }
  });

  test("lets every other request through", () => {
    const guard = guardFor("*", "https://app.example,null");
    expect(guard.rejectOpaqueOrigin(request({ origin: "https://app.example" }))).toBeNull();
    expect(guard.rejectOpaqueOrigin(request({}))).toBeNull();
  });

  test("admits null when origins are not checked", () => {
    expect(new RequestGuard(OPEN_REQUEST_GUARD_POLICY).rejectOpaqueOrigin(request({ origin: "null" }))).toBeNull();
  });
});

describe("comparableOriginOf", () => {
  test.each([
    ["http://localhost:5173", "http://localhost:5173"],
    ["HTTP://LocalHost:5173", "http://localhost:5173"],
    ["http://localhost:80", "http://localhost"],
    ["https://app.example.com:443", "https://app.example.com"],
    ["https://app.example.com/path?q=1", "https://app.example.com"],
    ["tauri://localhost", "tauri://localhost"],
  ])("%s compares as %s", (origin, expected) => {
    expect(comparableOriginOf(origin)).toBe(expected);
  });

  test.each([["null"], [""], ["not a url"], ["file:///home/me/page.html"]])("%p has no comparable origin", (origin) => {
    expect(comparableOriginOf(origin)).toBeNull();
  });
});

describe("RequestGuard.listsOrigin", () => {
  test("is true only for an origin the list names", () => {
    const guard = guardFor("*", "https://app.example.com,http://localhost:*");

    expect(guard.listsOrigin("https://app.example.com")).toBe(true);
    expect(guard.listsOrigin("HTTPS://APP.EXAMPLE.COM:443")).toBe(true);
    expect(guard.listsOrigin("http://localhost:5173")).toBe(true);
    expect(guard.listsOrigin("https://hosted.example")).toBe(false);
    expect(guard.listsOrigin("null")).toBe(false);
  });

  test("is false for every origin under the defaults, though reject admits the default origins", () => {
    const guard = new RequestGuard(policyFor({ extraDefaultOrigins: ["https://dashboard.example"] }));

    expect(guard.listsOrigin("http://localhost:5173")).toBe(false);
    expect(guard.listsOrigin("https://dashboard.example")).toBe(false);
    expect(guard.reject(request({ origin: "https://dashboard.example" }))).toBeNull();
  });

  test("is false for every origin when the check is off, though reject lets them all through", () => {
    const guard = guardFor("*", "*");

    expect(guard.listsOrigin("https://app.example.com")).toBe(false);
    expect(guard.reject(request({ origin: "https://app.example.com" }))).toBeNull();
  });
});
