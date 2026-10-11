import { describe, expect, it } from "bun:test";
import { SessionTokenService } from "../../src/scene/session-token";

describe("SessionTokenService", () => {
  it("mints a token that verifies back to the same claims", async () => {
    const svc = new SessionTokenService("test-secret");
    const token = await svc.mint({ sceneId: "scene-1" });
    const claims = await svc.verify(token);
    expect(claims).toEqual({ sceneId: "scene-1" });
  });

  it("rejects a token signed with a different secret", async () => {
    const a = new SessionTokenService("secret-a");
    const b = new SessionTokenService("secret-b");
    const token = await a.mint({ sceneId: "scene-1" });
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
    const expired = await new SignJWT({ sceneId: "scene-1" })
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

describe("SessionTokenService — editor tokens", () => {
  const tokens = new SessionTokenService("test-secret");

  it("lets an editor token open the editor, and nothing else", async () => {
    const editor = await tokens.mintEditor({ sceneId: "s1" });
    expect(await tokens.verifyEditor(editor)).toEqual({ sceneId: "s1" });
    expect(await tokens.verify(editor)).toBeNull();
  });

  it("never lets an overlay's session edit the scene", async () => {
    const session = await tokens.mint({ sceneId: "s1" });
    expect(await tokens.verify(session)).toEqual({ sceneId: "s1" });
    expect(await tokens.verifyEditor(session)).toBeNull();
  });
});

describe("SessionTokenService — composition preview tokens", () => {
  const tokens = new SessionTokenService("test-secret");

  it("opens the preview page with its token, and keeps the page's session apart from it", async () => {
    const entry = await tokens.mintPreview();
    const session = await tokens.mintPreviewSession();
    expect(await tokens.verifyPreview(entry)).toBe(true);
    expect(await tokens.verifyPreviewSession(session)).toBe(true);
    expect(await tokens.verifyPreview(session)).toBe(false);
    expect(await tokens.verifyPreviewSession(entry)).toBe(false);
  });

  it("is never an overlay's session or an editor's token, nor they a preview's", async () => {
    const entry = await tokens.mintPreview();
    const session = await tokens.mintPreviewSession();
    for (const preview of [entry, session]) {
      expect(await tokens.verify(preview)).toBeNull();
      expect(await tokens.verifyEditor(preview)).toBeNull();
    }
    for (const other of [await tokens.mint({ sceneId: "s1" }), await tokens.mintEditor({ sceneId: "s1" })]) {
      expect(await tokens.verifyPreview(other)).toBe(false);
      expect(await tokens.verifyPreviewSession(other)).toBe(false);
    }
  });

  it("refuses a preview token signed with another secret, or none at all", async () => {
    const entry = await new SessionTokenService("other-secret").mintPreview();
    expect(await tokens.verifyPreview(entry)).toBe(false);
    expect(await tokens.verifyPreview("")).toBe(false);
    expect(await tokens.verifyPreview("not-a-jwt")).toBe(false);
  });
});
