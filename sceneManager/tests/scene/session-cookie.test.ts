import { describe, expect, it } from "bun:test";
import { readSessionCookie, serializeSessionCookie, sessionCookieName } from "../../src/scene/session-cookie";

function requestWithCookies(...cookies: string[]): Request {
  return new Request("http://scene.test/scene/scene-a/events", { headers: { Cookie: cookies.join("; ") } });
}

describe("session cookie", () => {
  it("names the cookie after its scene", () => {
    expect(serializeSessionCookie("scene-a", "token-a", 60)).toStartWith(`${sessionCookieName("scene-a")}=token-a;`);
  });

  it("reads only the cookie for the requested scene when a browser holds several", () => {
    const req = requestWithCookies(
      `${sessionCookieName("scene-a")}=token-a`,
      `${sessionCookieName("scene-b")}=token-b`
    );
    expect(readSessionCookie(req, "scene-a")).toBe("token-a");
    expect(readSessionCookie(req, "scene-b")).toBe("token-b");
  });

  it("finds nothing for a scene the browser has no session for", () => {
    const req = requestWithCookies(`${sessionCookieName("scene-b")}=token-b`);
    expect(readSessionCookie(req, "scene-a")).toBeNull();
  });
});
