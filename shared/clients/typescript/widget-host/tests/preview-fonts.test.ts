import { describe, expect, it } from "bun:test";
import { FontRelay } from "../preview/fonts";

const FILE = "s/roboto/v51/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3GUBGEe.woff2";
const GOOGLE_CSS = `@font-face {
  font-family: 'Roboto';
  src: url(https://fonts.gstatic.com/${FILE}) format('woff2');
}`;

/** A Google that answers from `answer`, and the requests it was sent. */
function upstream(answer: (url: string) => Response | null) {
  const requests: Array<{ url: string; userAgent: string | null }> = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, userAgent: new Headers(init?.headers).get("User-Agent") });
    const response = answer(url);
    if (response === null) {
      throw new Error("offline");
    }
    return response;
  }) as typeof fetch;
  return { requests, fetchFn };
}

describe("FontRelay", () => {
  it("relays a family's stylesheet with its files pointed at the preview, and keeps it", async () => {
    const google = upstream(() => new Response(GOOGLE_CSS));
    const relay = new FontRelay(google.fetchFn);
    for (let i = 0; i < 2; i++) {
      const response = await relay.stylesheet("Roboto");
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
      expect(await response.text()).toContain(`url(/fonts/files/${FILE})`);
    }
    expect(google.requests).toHaveLength(1);
    expect(google.requests[0]?.url).toBe("https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap");
    expect(google.requests[0]?.userAgent).toContain("Chrome/");
  });

  it("asks for the plain family when Google refuses the weights", async () => {
    const google = upstream((url) =>
      url.includes("wght") ? new Response("", { status: 400 }) : new Response(GOOGLE_CSS)
    );
    const response = await new FontRelay(google.fetchFn).stylesheet("Open Sans");
    expect(response.status).toBe(200);
    expect(google.requests.map((request) => request.url)).toEqual([
      "https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700&display=swap",
      "https://fonts.googleapis.com/css2?family=Open+Sans&display=swap",
    ]);
  });

  it("finds nothing for a family Google does not publish, without asking", async () => {
    const google = upstream(() => new Response(GOOGLE_CSS));
    const relay = new FontRelay(google.fetchFn);
    for (const family of [null, "", "My Local Font", "Roboto; color: red", "../etc"]) {
      expect((await relay.stylesheet(family)).status).toBe(404);
    }
    expect(google.requests).toHaveLength(0);
  });

  it("answers 503 while Google cannot be reached, and asks again next time", async () => {
    let online = false;
    const google = upstream(() => (online ? new Response(GOOGLE_CSS) : null));
    const relay = new FontRelay(google.fetchFn);
    expect((await relay.stylesheet("Roboto")).status).toBe(503);
    online = true;
    expect((await relay.stylesheet("Roboto")).status).toBe(200);
  });

  it("relays only font files as Google publishes them", async () => {
    const google = upstream((url) =>
      url.endsWith(FILE) ? new Response(new Uint8Array([1, 2, 3])) : new Response("", { status: 500 })
    );
    const relay = new FontRelay(google.fetchFn);
    const file = await relay.file(FILE);
    expect(file.status).toBe(200);
    expect(file.headers.get("Content-Type")).toBe("font/woff2");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(google.requests.map((request) => request.url)).toEqual([`https://fonts.gstatic.com/${FILE}`]);

    for (const path of ["../secret", "s/roboto/v51/x.ttf", "https://evil.test/x.woff2"]) {
      expect((await relay.file(path)).status).toBe(404);
    }
    expect(google.requests).toHaveLength(1);
    expect((await relay.file("s/roboto/v51/Missing.woff2")).status).toBe(503);
  });
});
