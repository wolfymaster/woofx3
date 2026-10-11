import { describe, expect, test } from "bun:test";
import { compositionsRoutes } from "../src/routes/compositions";

function fakeLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

function call(nats: unknown, storedUrl = "") {
  const route = compositionsRoutes.getCompositionPreviewUrl as unknown as () => Promise<unknown>;
  const db = { getSetting: async (key: string) => (key === "scene.publicUrl" ? storedUrl : "") };
  return route.call({ nats, db, sceneManagerUrl: "http://scenes.local:9000/", logger: fakeLogger() });
}

function answering(reply: unknown, asked: string[] = []) {
  return {
    async request(subject: string) {
      asked.push(subject);
      return { data: new TextEncoder().encode(JSON.stringify(reply)) };
    },
  };
}

describe("getCompositionPreviewUrl", () => {
  test("asks the scene manager for a preview token and puts it under its public URL", async () => {
    const asked: string[] = [];
    const nats = answering({ ok: true, token: "a.b/c", expiresInSeconds: 300, path: "/preview/composition" }, asked);
    expect(await call(nats)).toEqual({
      url: "http://scenes.local:9000/preview/composition?token=a.b%2Fc",
      expiresInSeconds: 300,
    });
    expect(asked).toEqual(["engine.scene.composition-preview-token"]);
  });

  test("prefers the public URL stored in settings", async () => {
    const nats = answering({ ok: true, token: "t", expiresInSeconds: 300, path: "/preview/composition" });
    expect(await call(nats, "https://scenes.example.tv/")).toEqual({
      url: "https://scenes.example.tv/preview/composition?token=t",
      expiresInSeconds: 300,
    });
  });

  test("is null when the scene manager refuses, does not answer, or there is no bus", async () => {
    expect(await call(answering({ ok: false, reason: "no" }))).toBeNull();
    expect(
      await call({
        async request() {
          throw new Error("timeout");
        },
      })
    ).toBeNull();
    expect(await call(null)).toBeNull();
  });
});
