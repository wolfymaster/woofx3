import { describe, expect, test } from "bun:test";
import { scenesRoutes } from "../src/routes/scenes";

function fakeLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

function call(nats: unknown, sceneId = "scene-1") {
  const route = scenesRoutes.getSceneEditorSession as unknown as (id: string) => Promise<unknown>;
  return route.call({ nats, logger: fakeLogger() }, sceneId);
}

function answering(reply: unknown, asked: Array<{ subject: string; body: unknown }> = []) {
  return {
    async request(subject: string, data: Uint8Array) {
      asked.push({ subject, body: JSON.parse(new TextDecoder().decode(data)) });
      return { data: new TextEncoder().encode(JSON.stringify(reply)) };
    },
  };
}

describe("getSceneEditorSession", () => {
  test("asks the scene manager for an editor token for the scene", async () => {
    const asked: Array<{ subject: string; body: unknown }> = [];
    const nats = answering({ ok: true, token: "t", expiresInSeconds: 300, path: "/scene/scene-1/edit" }, asked);
    expect(await call(nats)).toEqual({ token: "t", path: "/scene/scene-1/edit", expiresInSeconds: 300 });
    expect(asked).toEqual([{ subject: "engine.scene.editor-token", body: { sceneId: "scene-1" } }]);
  });

  test("is null for a scene the scene manager refuses, one it cannot reach, or no scene", async () => {
    expect(await call(answering({ ok: false, reason: "scene not found" }))).toBeNull();
    expect(
      await call({
        async request() {
          throw new Error("timeout");
        },
      })
    ).toBeNull();
    expect(await call(null)).toBeNull();
    expect(await call(answering({ ok: true }), "")).toBeNull();
  });
});
