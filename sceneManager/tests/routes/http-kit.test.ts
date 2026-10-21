import { describe, expect, it } from "bun:test";
import { jsonError, readJsonBody, readTextBody, requireSceneSession } from "../../src/routes/http-kit";

function post(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request("http://scene.test/x", { method: "POST", body, headers });
}

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
}

describe("jsonError", () => {
  it("is JSON, carries the code and detail, and is never cached", async () => {
    const resp = jsonError(503, "unavailable", { instanceIds: ["a"] });
    expect(resp.status).toBe(503);
    expect(resp.headers.get("Cache-Control")).toBe("no-store");
    expect(resp.headers.get("Content-Type")).toContain("application/json");
    expect(await resp.json()).toEqual({ error: "unavailable", instanceIds: ["a"] });
  });
});

describe("readTextBody and readJsonBody", () => {
  it("read a body within the limit", async () => {
    expect(await readJsonBody(post('{"a":1}'), 100)).toEqual({ ok: true, value: { a: 1 } });
  });

  it("refuse a declared length over the limit without reading", async () => {
    const read = await readTextBody(post("x", { "Content-Length": "1000" }), 100);
    expect(read.ok).toBe(false);
    expect(read.ok ? 0 : read.response.status).toBe(413);
  });

  it("stop reading a body that turns out longer than the limit", async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(64));
      },
    });
    const read = await readTextBody(
      new Request("http://scene.test/x", { method: "POST", body, duplex: "half" } as RequestInit),
      100
    );
    expect(read.ok ? 0 : read.response.status).toBe(413);
    expect(pulled).toBeLessThan(10);
  });

  it("join a body sent in pieces", async () => {
    const req = new Request("http://scene.test/x", {
      method: "POST",
      body: streamOf(['{"inst', 'anceIds":["a"]}']),
      duplex: "half",
    } as RequestInit);
    expect(await readJsonBody(req, 100)).toEqual({ ok: true, value: { instanceIds: ["a"] } });
  });

  it("answer a body that is not JSON with 400", async () => {
    const read = await readJsonBody(post("{not json"), 100);
    expect(read.ok ? 0 : read.response.status).toBe(400);
  });
});

describe("requireSceneSession", () => {
  const tokens = { verify: async (token: string) => (token === "good" ? { sceneId: "s1", authAt: 1 } : null) };
  const withCookie = (value: string, scene = "s1") =>
    new Request("http://scene.test/x", { headers: { Cookie: `sm_session_${scene}=${value}` } });

  it("gives the claims of a valid session for the scene", async () => {
    expect(await requireSceneSession(withCookie("good"), "s1", tokens as never)).toEqual({ sceneId: "s1", authAt: 1 });
  });

  it("refuses no cookie, a bad token, and a session for another scene", async () => {
    expect(await requireSceneSession(new Request("http://scene.test/x"), "s1", tokens as never)).toBeNull();
    expect(await requireSceneSession(withCookie("bad"), "s1", tokens as never)).toBeNull();
    expect(await requireSceneSession(withCookie("good", "s2"), "s2", tokens as never)).toBeNull();
  });
});
