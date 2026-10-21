import { describe, expect, it } from "bun:test";
import type { HttpDeps } from "../../src/http";
import { handleSessionRefreshRoute } from "../../src/routes/session";
import { readSessionCookie } from "../../src/scene/session-cookie";
import { nowSeconds, SESSION_REAUTH_SECONDS, SessionTokenService } from "../../src/scene/session-token";

const tokens = new SessionTokenService("test-secret");

/** Overlay tokens the fake host knows, by the scene each opens. */
function deps(known: Record<string, string> = {}): HttpDeps {
  return {
    sessionTokens: tokens,
    host: { sceneIdOfToken: async (token: string) => known[token] ?? null },
  } as unknown as HttpDeps;
}

async function refresh(authAt: number | null, body?: unknown, d: HttpDeps = deps()): Promise<Response> {
  const headers: Record<string, string> = {};
  if (authAt !== null) {
    headers.Cookie = `sm_session_s1=${await tokens.mint({ sceneId: "s1", authAt })}`;
  }
  const init: RequestInit = { method: "POST", headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return handleSessionRefreshRoute(new Request("http://scene.test/scene/s1/session/refresh", init), "s1", d);
}

/** The `authAt` of the session a refresh set. */
async function renewedAuthAt(response: Response): Promise<number | null> {
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0]!;
  const token = readSessionCookie(new Request("http://scene.test/", { headers: { Cookie: cookie } }), "s1");
  return token ? ((await tokens.verify(token))?.authAt ?? null) : null;
}

describe("session refresh", () => {
  it("renews a session inside the re-auth window without asking for the overlay token", async () => {
    const authAt = nowSeconds() - 60;
    const response = await refresh(authAt);
    expect(response.status).toBe(200);
    expect(await renewedAuthAt(response)).toBe(authAt);
  });

  it("refuses a session past the window that brings no overlay token", async () => {
    expect((await refresh(nowSeconds() - SESSION_REAUTH_SECONDS)).status).toBe(401);
    expect((await refresh(nowSeconds() - SESSION_REAUTH_SECONDS, { token: "" })).status).toBe(401);
  });

  it("renews a session past the window, from now, when its overlay token still opens the scene", async () => {
    const before = nowSeconds();
    const response = await refresh(before - SESSION_REAUTH_SECONDS - 5, { token: "ovl" }, deps({ ovl: "s1" }));
    expect(response.status).toBe(200);
    expect(await renewedAuthAt(response)).toBeGreaterThanOrEqual(before);
  });

  it("refuses a session past the window whose overlay token is revoked or opens another scene", async () => {
    const old = nowSeconds() - SESSION_REAUTH_SECONDS - 5;
    expect((await refresh(old, { token: "revoked" }, deps({}))).status).toBe(401);
    expect((await refresh(old, { token: "other" }, deps({ other: "s2" }))).status).toBe(401);
  });

  it("refuses a refresh with no session", async () => {
    expect((await refresh(null, { token: "ovl" }, deps({ ovl: "s1" }))).status).toBe(401);
  });
});
