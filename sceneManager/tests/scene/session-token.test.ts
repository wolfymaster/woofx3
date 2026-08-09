import { describe, expect, it } from "bun:test";
import { SessionTokenService } from "../../src/scene/session-token";

describe("SessionTokenService", () => {
  it("mints a token that verifies back to the same claims", async () => {
    const svc = new SessionTokenService("test-secret");
    const token = await svc.mint({ sceneId: "scene-1", applicationId: "app-1" });
    const claims = await svc.verify(token);
    expect(claims).toEqual({ sceneId: "scene-1", applicationId: "app-1" });
  });

  it("rejects a token signed with a different secret", async () => {
    const a = new SessionTokenService("secret-a");
    const b = new SessionTokenService("secret-b");
    const token = await a.mint({ sceneId: "scene-1", applicationId: "app-1" });
    expect(await b.verify(token)).toBeNull();
  });

  it("rejects a malformed token without throwing", async () => {
    const svc = new SessionTokenService("test-secret");
    expect(await svc.verify("not-a-jwt")).toBeNull();
    expect(await svc.verify("")).toBeNull();
  });

  it("rejects an expired token", async () => {
    const svc = new SessionTokenService("test-secret");
    // Mint with an already-past expiration by constructing directly.
    const { SignJWT } = await import("jose");
    const key = new TextEncoder().encode("test-secret");
    const expired = await new SignJWT({ sceneId: "scene-1", applicationId: "app-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);
    expect(await svc.verify(expired)).toBeNull();
  });

  it("throws at construction time when the secret is empty", () => {
    expect(() => new SessionTokenService("")).toThrow();
  });
});
