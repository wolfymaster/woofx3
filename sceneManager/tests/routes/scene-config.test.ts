import { describe, expect, it, mock } from "bun:test";
import { type SceneSnapshot, configOfSnapshot } from "../../public/scene-manager/scene-document";
import type { HttpDeps } from "../../src/http";
import { handleSceneConfigRoute } from "../../src/routes/scene";

const SNAPSHOT: SceneSnapshot = {
  sceneId: "scene-1",
  name: "Main",
  seq: 3,
  doc: {
    layout: {},
    widgets: {
      w1: {
        widget: "woofx3:widget:text",
        x: 1,
        y: 2,
        width: 3,
        height: 4,
        visible: true,
        z: "a0000",
        settings: {},
        name: "Text",
        rotation: 0,
        opacity: 1,
        locked: false,
        extra: {},
      },
    },
  },
  meta: { w1: { moduleId: "woofx3", hostsSurface: "", frameUrl: "/frames/woofx3/text?v=x", linkedResources: {} } },
};

function deps() {
  const snapshot = mock(async (sceneId: string) => (sceneId === "scene-1" ? SNAPSHOT : null));
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
    sceneDocuments: { snapshot },
  };
  return { deps: d as unknown as HttpDeps, snapshot };
}

function request(sceneId: string, cookie: string | null): Request {
  return new Request(`http://scene.test/scene/${sceneId}/config`, {
    headers: cookie === null ? {} : { Cookie: `sm_session_${sceneId}=${cookie}` },
  });
}

describe("handleSceneConfigRoute", () => {
  it("returns the scene the session is for, with the document later ops apply to", async () => {
    const { deps: d } = deps();
    const resp = await handleSceneConfigRoute(request("scene-1", "good"), "scene-1", d);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Cache-Control")).toBe("no-store");
    expect(await resp.json()).toEqual({ scene: configOfSnapshot(SNAPSHOT), document: SNAPSHOT });
  });

  it("refuses a missing session, or one for another scene", async () => {
    const { deps: d, snapshot } = deps();
    expect((await handleSceneConfigRoute(request("scene-1", null), "scene-1", d)).status).toBe(401);
    expect((await handleSceneConfigRoute(request("scene-1", "bad"), "scene-1", d)).status).toBe(401);
    expect((await handleSceneConfigRoute(request("scene-2", "good"), "scene-2", d)).status).toBe(401);
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("serves the editor's draft to a page that asks for it", async () => {
    const { deps: d, snapshot } = deps();
    const draft = new Request("http://scene.test/scene/scene-1/config?view=draft", {
      headers: { Cookie: "sm_session_scene-1=good" },
    });
    await handleSceneConfigRoute(draft, "scene-1", d);
    expect(snapshot).toHaveBeenLastCalledWith("scene-1", "draft");
    await handleSceneConfigRoute(request("scene-1", "good"), "scene-1", d);
    expect(snapshot).toHaveBeenLastCalledWith("scene-1", "published");
  });

  it("answers 404 for a scene that no longer loads", async () => {
    const { deps: d } = deps();
    expect((await handleSceneConfigRoute(request("scene-gone", "gone"), "scene-gone", d)).status).toBe(404);
  });
});
