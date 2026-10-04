import { describe, expect, it, mock } from "bun:test";
import type { HttpDeps } from "../../src/http";
import { handleSceneConfigRoute } from "../../src/routes/scene";

const SCENE = { scene: { id: "scene-1", name: "Main", layout: {}, widgets: [] } };

function deps() {
  const buildConfigById = mock(async (sceneId: string) => (sceneId === "scene-1" ? SCENE : { scene: null }));
  const d = {
    sessionTokens: {
      verify: async (token: string) => {
        if (token === "good") {
          return { sceneId: "scene-1" };
        }
        if (token === "gone") {
          return { sceneId: "scene-gone" };
        }
        return null;
      },
    },
    host: { buildConfigById },
  };
  return { deps: d as unknown as HttpDeps, buildConfigById };
}

function request(sceneId: string, cookie: string | null): Request {
  return new Request(`http://scene.test/scene/${sceneId}/config`, {
    headers: cookie === null ? {} : { Cookie: `sm_session=${cookie}` },
  });
}

describe("handleSceneConfigRoute", () => {
  it("returns the config of the scene the session is for", async () => {
    const { deps: d } = deps();
    const resp = await handleSceneConfigRoute(request("scene-1", "good"), "scene-1", d);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Cache-Control")).toBe("no-store");
    expect(await resp.json()).toEqual(SCENE);
  });

  it("refuses a missing session, or one for another scene", async () => {
    const { deps: d, buildConfigById } = deps();
    expect((await handleSceneConfigRoute(request("scene-1", null), "scene-1", d)).status).toBe(401);
    expect((await handleSceneConfigRoute(request("scene-1", "bad"), "scene-1", d)).status).toBe(401);
    expect((await handleSceneConfigRoute(request("scene-2", "good"), "scene-2", d)).status).toBe(401);
    expect(buildConfigById).not.toHaveBeenCalled();
  });

  it("answers 404 for a scene that no longer loads", async () => {
    const { deps: d } = deps();
    expect((await handleSceneConfigRoute(request("scene-gone", "gone"), "scene-gone", d)).status).toBe(404);
  });
});
