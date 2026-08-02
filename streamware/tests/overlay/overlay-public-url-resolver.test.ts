import { describe, expect, it, mock } from "bun:test";
import {
  OverlayPublicUrlResolver,
  OVERLAY_PUBLIC_URL_CACHE_TTL_MS,
  OVERLAY_PUBLIC_URL_SETTING_KEY,
} from "../../src/overlay/overlay-public-url-resolver";
import type { OverlayPublicUrlDb } from "../../src/overlay/overlay-public-url-resolver";

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

describe("OverlayPublicUrlResolver", () => {
  it("falls back to the default when no db client is configured", async () => {
    const resolver = new OverlayPublicUrlResolver(null, "http://127.0.0.1:9100/", fakeLogger());
    const result = await resolver.resolve();
    expect(result).toBe("http://127.0.0.1:9100");
  });

  it("falls back to an empty string when unconfigured (no hardcoded guess)", async () => {
    const resolver = new OverlayPublicUrlResolver(null, "", fakeLogger());
    const result = await resolver.resolve();
    expect(result).toBe("");
  });

  it("falls back to the default when the setting is unset", async () => {
    const db: OverlayPublicUrlDb = { getSetting: mock(async () => null) };
    const resolver = new OverlayPublicUrlResolver(db, "http://127.0.0.1:9100", fakeLogger());
    const result = await resolver.resolve();
    expect(result).toBe("http://127.0.0.1:9100");
  });

  it("queries with an empty (global) applicationId, matching barkloader's storage.* settings convention", async () => {
    const getSetting = mock(async (key: string, applicationId: string) => {
      expect(key).toBe(OVERLAY_PUBLIC_URL_SETTING_KEY);
      expect(applicationId).toBe("");
      return "https://tunnel.example.com/";
    });
    const db: OverlayPublicUrlDb = { getSetting };
    const resolver = new OverlayPublicUrlResolver(db, "http://127.0.0.1:9100", fakeLogger());

    const result = await resolver.resolve();
    expect(result).toBe("https://tunnel.example.com");
  });

  it("uses the configured setting, trimmed of trailing slashes, and caches it", async () => {
    const getSetting = mock(async () => "https://tunnel.example.com/");
    const db: OverlayPublicUrlDb = { getSetting };
    const resolver = new OverlayPublicUrlResolver(db, "http://127.0.0.1:9100", fakeLogger());

    const result = await resolver.resolve();
    expect(result).toBe("https://tunnel.example.com");

    // Second call within the cache TTL must not round-trip again.
    await resolver.resolve();
    expect(getSetting).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default on a transport error, without throwing", async () => {
    const db: OverlayPublicUrlDb = {
      getSetting: mock(async () => {
        throw new Error("db-proxy unreachable");
      }),
    };
    const resolver = new OverlayPublicUrlResolver(db, "http://127.0.0.1:9100", fakeLogger());
    const result = await resolver.resolve();
    expect(result).toBe("http://127.0.0.1:9100");
  });

  it("respects TTL — re-queries after expiry", async () => {
    let now = 1_000_000;
    const getSetting = mock(async () => "https://tunnel.example.com");
    const db: OverlayPublicUrlDb = { getSetting };
    const resolver = new OverlayPublicUrlResolver(db, "http://127.0.0.1:9100", fakeLogger(), {
      ttlMs: OVERLAY_PUBLIC_URL_CACHE_TTL_MS,
      now: () => now,
    });

    await resolver.resolve();
    expect(getSetting).toHaveBeenCalledTimes(1);

    // Before TTL expires — cached.
    now += OVERLAY_PUBLIC_URL_CACHE_TTL_MS - 1;
    await resolver.resolve();
    expect(getSetting).toHaveBeenCalledTimes(1);

    // After TTL expires — must re-query.
    now += 2;
    await resolver.resolve();
    expect(getSetting).toHaveBeenCalledTimes(2);
  });
});
