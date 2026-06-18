import { describe, expect, it, mock } from "bun:test";
import {
  maskToken,
  OverlayTokenResolver,
  OVERLAY_TOKEN_CACHE_TTL_MS,
} from "../../src/overlay/token-resolver";
import type { OverlayTokenDb } from "../../src/overlay/token-resolver";

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

function okResponse(sceneId: string, applicationId: string) {
  return {
    status: { code: "OK" as const, message: "" },
    sceneId,
    applicationId,
  };
}

function notFoundResponse() {
  return {
    status: { code: "NOT_FOUND" as const, message: "" },
    sceneId: "",
    applicationId: "",
  };
}

describe("maskToken", () => {
  it("masks a short token (8 chars or fewer)", () => {
    const masked = maskToken("ovl_ab");
    expect(masked).toBe("ovl_…");
    expect(masked).not.toContain("ab");
  });

  it("masks a long token (over 8 chars)", () => {
    const token = "ovl_abcdef1234567890";
    const masked = maskToken(token);
    expect(masked).toBe("ovl_abcd…");
    expect(masked).not.toContain("1234567890");
  });

  it("handles exactly 8 chars", () => {
    const masked = maskToken("12345678");
    expect(masked).toBe("1234…");
  });
});

describe("OverlayTokenResolver", () => {
  it("resolves an active token via db", async () => {
    const db: OverlayTokenDb = {
      resolveOverlayToken: mock(async () => okResponse("scene-1", "app-1")),
    };
    const resolver = new OverlayTokenResolver(db, fakeLogger());
    const result = await resolver.resolve("ovl_token1");
    expect(result).toEqual({ sceneId: "scene-1", applicationId: "app-1" });
  });

  it("returns null for NOT_FOUND and negatively caches the miss", async () => {
    const dbCall = mock(async () => notFoundResponse());
    const db: OverlayTokenDb = { resolveOverlayToken: dbCall };
    const resolver = new OverlayTokenResolver(db, fakeLogger());

    const r1 = await resolver.resolve("ovl_missing");
    expect(r1).toBeNull();

    // Second call should be served from cache, not from db.
    const r2 = await resolver.resolve("ovl_missing");
    expect(r2).toBeNull();
    expect(dbCall).toHaveBeenCalledTimes(1);
  });

  it("does NOT cache transport errors — retries on next request", async () => {
    let callCount = 0;
    const db: OverlayTokenDb = {
      resolveOverlayToken: mock(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("connection refused");
        }
        return okResponse("scene-2", "app-2");
      }),
    };
    const resolver = new OverlayTokenResolver(db, fakeLogger());

    const r1 = await resolver.resolve("ovl_retry");
    expect(r1).toBeNull();
    expect(resolver.cacheSize()).toBe(0);

    const r2 = await resolver.resolve("ovl_retry");
    expect(r2).toEqual({ sceneId: "scene-2", applicationId: "app-2" });
    expect(callCount).toBe(2);
  });

  it("respects TTL — re-queries after expiry", async () => {
    let now = 1_000_000;
    const dbCall = mock(async () => okResponse("scene-3", "app-3"));
    const db: OverlayTokenDb = { resolveOverlayToken: dbCall };
    const resolver = new OverlayTokenResolver(db, fakeLogger(), {
      ttlMs: 30_000,
      now: () => now,
    });

    await resolver.resolve("ovl_ttl");
    expect(dbCall).toHaveBeenCalledTimes(1);

    // Before TTL expires — cached.
    now += 29_999;
    await resolver.resolve("ovl_ttl");
    expect(dbCall).toHaveBeenCalledTimes(1);

    // After TTL expires — must re-query.
    now += 2;
    await resolver.resolve("ovl_ttl");
    expect(dbCall).toHaveBeenCalledTimes(2);
  });

  it("invalidateAll clears the cache so the next resolve hits db", async () => {
    const dbCall = mock(async () => okResponse("scene-4", "app-4"));
    const db: OverlayTokenDb = { resolveOverlayToken: dbCall };
    const resolver = new OverlayTokenResolver(db, fakeLogger());

    await resolver.resolve("ovl_inv");
    expect(dbCall).toHaveBeenCalledTimes(1);
    expect(resolver.cacheSize()).toBe(1);

    resolver.invalidateAll();
    expect(resolver.cacheSize()).toBe(0);

    await resolver.resolve("ovl_inv");
    expect(dbCall).toHaveBeenCalledTimes(2);
  });

  it("returns null for an empty token without calling db", async () => {
    const dbCall = mock(async () => okResponse("x", "y"));
    const db: OverlayTokenDb = { resolveOverlayToken: dbCall };
    const resolver = new OverlayTokenResolver(db, fakeLogger());
    const result = await resolver.resolve("");
    expect(result).toBeNull();
    expect(dbCall).not.toHaveBeenCalled();
  });

  it("returns null when db is null (no db-proxy configured)", async () => {
    const resolver = new OverlayTokenResolver(null, fakeLogger());
    const result = await resolver.resolve("ovl_nodb");
    expect(result).toBeNull();
  });
});
