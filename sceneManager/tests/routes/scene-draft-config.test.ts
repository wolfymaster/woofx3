import { describe, expect, it, mock } from "bun:test";
import type { HttpDeps } from "../../src/http";
import { handleSceneDraftConfigRoute } from "../../src/routes/scene";
import { MediaProxy } from "../../src/scene/media-proxy";

const SCENE = { scene: { id: "scene-1", name: "Main", layout: {}, widgets: [] } };

function deps() {
  const buildDraftConfig = mock(async (sceneId: string, _widgets: unknown[]) =>
    sceneId === "scene-1" ? SCENE : { scene: null }
  );
  const d = {
    sessionTokens: { verify: async (token: string) => (token === "good" ? { sceneId: "scene-1" } : null) },
    host: { buildDraftConfig },
    mediaProxy: new MediaProxy("test-secret"),
  };
  return { deps: d as unknown as HttpDeps, buildDraftConfig };
}

function request(body: string, cookie = "good"): Request {
  return new Request("http://scene.test/scene/scene-1/draft-config", {
    method: "POST",
    headers: { Cookie: `sm_session_scene-1=${cookie}`, "Content-Type": "application/json" },
    body,
  });
}

describe("handleSceneDraftConfigRoute", () => {
  it("builds the config from the posted placements", async () => {
    const { deps: d, buildDraftConfig } = deps();
    const widgets = [{ id: "a", widgetCanonicalId: "woofx3:widget:text" }];
    const resp = await handleSceneDraftConfigRoute(request(JSON.stringify({ widgets })), "scene-1", d);
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ ...SCENE, mediaUrls: {} });
    expect(buildDraftConfig).toHaveBeenCalledWith("scene-1", widgets);
  });

  it("refuses a session for another scene before reading the body", async () => {
    const { deps: d, buildDraftConfig } = deps();
    expect((await handleSceneDraftConfigRoute(request("{}", "bad"), "scene-1", d)).status).toBe(401);
    expect(buildDraftConfig).not.toHaveBeenCalled();
  });

  it("refuses a body that is not a list of placements", async () => {
    const { deps: d } = deps();
    expect((await handleSceneDraftConfigRoute(request("nope"), "scene-1", d)).status).toBe(400);
    expect((await handleSceneDraftConfigRoute(request('{"widgets":{}}'), "scene-1", d)).status).toBe(400);
  });
});
