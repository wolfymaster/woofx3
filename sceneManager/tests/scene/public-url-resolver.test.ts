import { describe, expect, it, mock } from "bun:test";
import {
  PublicUrlResolver,
  PUBLIC_URL_CACHE_TTL_MS,
  PUBLIC_URL_SETTING_KEY,
} from "../../src/scene/public-url-resolver";
import type { PublicUrlDb } from "../../src/scene/public-url-resolver";

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

describe("PublicUrlResolver", () => {
  it("resolves the renamed scene.publicUrl key (not the old overlay.publicUrl)", () => {
    expect(PUBLIC_URL_SETTING_KEY).toBe("scene.publicUrl");
  });

  it("falls back to the default when no db client is configured", async () => {
    const resolver = new PublicUrlResolver(null, "http://127.0.0.1:9101/", fakeLogger());
    const result = await resolver.resolve();
    expect(result).toBe("http://127.0.0.1:9101");
  });

  it("falls back to an empty string when unconfigured (no hardcoded guess)", async () => {
    const resolver = new PublicUrlResolver(null, "", fakeLogger());
    const result = await resolver.resolve();
    expect(result).toBe("");
  });

  it("falls back to the default when the setting is unset", async () => {
    const db: PublicUrlDb = { getSetting: mock(async () => null) };
    const resolver = new PublicUrlResolver(db, "http://127.0.0.1:9101", fakeLogger());
    const result = await resolver.resolve();
    expect(result).toBe("http://127.0.0.1:9101");
  });

  it("queries scene.publicUrl with an empty (global) applicationId", async () => {
    const getSetting = mock(async (key: string, applicationId: string) => {
      expect(key).toBe(PUBLIC_URL_SETTING_KEY);
      expect(applicationId).toBe("");
      return "https://scene.example.com/";
    });
    const db: PublicUrlDb = { getSetting };
    const resolver = new PublicUrlResolver(db, "http://127.0.0.1:9101", fakeLogger());

    const result = await resolver.resolve();
    expect(result).toBe("https://scene.example.com");
  });

  it("uses the configured setting, trimmed of trailing slashes, and caches it", async () => {
    const getSetting = mock(async () => "https://scene.example.com/");
    const db: PublicUrlDb = { getSetting };
    const resolver = new PublicUrlResolver(db, "http://127.0.0.1:9101", fakeLogger());

    const result = await resolver.resolve();
    expect(result).toBe("https://scene.example.com");

    await resolver.resolve();
    expect(getSetting).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default on a transport error, without throwing", async () => {
    const db: PublicUrlDb = {
      getSetting: mock(async () => {
        throw new Error("db-proxy unreachable");
      }),
    };
    const resolver = new PublicUrlResolver(db, "http://127.0.0.1:9101", fakeLogger());
    const result = await resolver.resolve();
    expect(result).toBe("http://127.0.0.1:9101");
  });

  it("respects TTL — re-queries after expiry", async () => {
    let now = 1_000_000;
    const getSetting = mock(async () => "https://scene.example.com");
    const db: PublicUrlDb = { getSetting };
    const resolver = new PublicUrlResolver(db, "http://127.0.0.1:9101", fakeLogger(), {
      ttlMs: PUBLIC_URL_CACHE_TTL_MS,
      now: () => now,
    });

    await resolver.resolve();
    expect(getSetting).toHaveBeenCalledTimes(1);

    now += PUBLIC_URL_CACHE_TTL_MS - 1;
    await resolver.resolve();
    expect(getSetting).toHaveBeenCalledTimes(1);

    now += 2;
    await resolver.resolve();
    expect(getSetting).toHaveBeenCalledTimes(2);
  });
});
