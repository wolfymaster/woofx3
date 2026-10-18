import { describe, expect, it } from "bun:test";
import { SignJWT } from "jose";
import {
  EDITOR_TOKEN_TTL_SECONDS,
  PREVIEW_TOKEN_TTL_SECONDS,
  SessionTokenService,
  sceneTokenIssuer,
} from "../../src/scene/session-token";

describe("SessionTokenService", () => {
  it("mints a token that verifies back to the same claims", async () => {
    const svc = new SessionTokenService("test-secret");
    const token = await svc.mint({ sceneId: "scene-1", authAt: 1_700_000_000 });
    const claims = await svc.verify(token);
    expect(claims).toEqual({ sceneId: "scene-1", authAt: 1_700_000_000 });
  });

  it("reads a session minted before authAt existed as verified when it was issued", async () => {
    const secret = "test-secret";
    const legacy = await new SignJWT({ sceneId: "scene-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(1_700_000_123)
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(secret));
    expect(await new SessionTokenService(secret).verify(legacy)).toEqual({ sceneId: "scene-1", authAt: 1_700_000_123 });
  });

  it("rejects a token signed with a different secret", async () => {
    const a = new SessionTokenService("secret-a");
    const b = new SessionTokenService("secret-b");
    const token = await a.mint({ sceneId: "scene-1", authAt: 0 });
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
    expect(await tokens.verifyEditor(editor)).toMatchObject({ sceneId: "s1" });
    expect(await tokens.verify(editor)).toBeNull();
  });

  it("never lets an overlay's session edit the scene", async () => {
    const session = await tokens.mint({ sceneId: "s1", authAt: 5 });
    expect(await tokens.verify(session)).toEqual({ sceneId: "s1", authAt: 5 });
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
    for (const other of [await tokens.mint({ sceneId: "s1", authAt: 0 }), await tokens.mintEditor({ sceneId: "s1" })]) {
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

describe("sceneTokenIssuer", () => {
  const issuer = () => sceneTokenIssuer(new SessionTokenService("x".repeat(32)), async (sceneId) => sceneId === "s1");

  it("issues an editor token for a scene that exists, with its lifetime and path", async () => {
    const reply = await issuer().editorToken("s1");
    expect(reply).toMatchObject({ ok: true, expiresInSeconds: EDITOR_TOKEN_TTL_SECONDS });
    expect(reply.ok && reply.path).toContain("s1");
  });

  it("refuses an editor token for a scene that does not", async () => {
    expect(await issuer().editorToken("nope")).toEqual({ ok: false, reason: "scene not found" });
  });

  it("issues a preview token", async () => {
    expect(await issuer().previewToken()).toMatchObject({ ok: true, expiresInSeconds: PREVIEW_TOKEN_TTL_SECONDS });
  });
});
