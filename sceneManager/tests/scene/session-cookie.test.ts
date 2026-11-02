import { describe, expect, it } from "bun:test";
import {
  readSessionCookie,
  serializeCookie,
  serializeSessionCookie,
  sessionCookieName,
} from "../../src/scene/session-cookie";

function requestWithCookies(...cookies: string[]): Request {
  return new Request("http://scene.test/scene/scene-a/events", { headers: { Cookie: cookies.join("; ") } });
}

describe("session cookie", () => {
  it("names the cookie after its scene", () => {
    expect(serializeSessionCookie(requestWithCookies(), "scene-a", "token-a", 60)).toStartWith(
      `${sessionCookieName("scene-a")}=token-a;`
    );
  });

  const FRAMEABLE = ["SameSite=None", "Secure", "Partitioned"];
  const STRICT = ["SameSite=Strict"];
  const cases: { name: string; url: string; forwarded?: string; expected: string[] }[] = [
    { name: "direct HTTPS", url: "https://scene.test/", expected: FRAMEABLE },
    { name: "HTTPS ended at an edge", url: "http://scene.test/", forwarded: "https", expected: FRAMEABLE },
    {
      name: "the client's hop of a proxy chain",
      url: "http://scene.test/",
      forwarded: "HTTPS, http",
      expected: FRAMEABLE,
    },
    { name: "direct HTTP", url: "http://scene.test/", expected: STRICT },
    { name: "HTTP forwarded over HTTPS", url: "https://scene.test/", forwarded: "http", expected: STRICT },
  ];
  for (const { name, url, forwarded, expected } of cases) {
    it(`sets the attributes for ${name}`, () => {
      const headers: Record<string, string> = forwarded ? { "X-Forwarded-Proto": forwarded } : {};
      const attributes = serializeCookie(new Request(url, { headers }), "name", "value", 60).split("; ");
      expect(
        attributes.filter((part) => part.startsWith("SameSite") || part === "Secure" || part === "Partitioned")
      ).toEqual(expected);
      expect(attributes).toContain("HttpOnly");
    });
  }

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
