import { describe, expect, it, mock } from "bun:test";
import type { HttpDeps } from "../../src/http";
import { handleWidgetStorageRoute } from "../../src/routes/widget-storage";

const KEY = "state:woofx3:counter:deaths";

const logger = {
  debug: mock(() => undefined),
  info: mock(() => undefined),
  warn: mock(() => undefined),
  error: mock(() => undefined),
};

function placement(id: string, moduleId: string, hostsSurface = "") {
  return { id, moduleId, hostsSurface };
}

function deps(opts: { read?: (...args: unknown[]) => Promise<unknown> } = {}) {
  const read = mock(opts.read ?? (async () => ({ value: 3, reached: {} })));
  const d = {
    ctx: { logger },
    sessionTokens: {
      verify: async (token: string) => (token === "good" ? { sceneId: "scene-1", applicationId: "app-1" } : null),
    },
    host: {
      loadSceneById: async (sceneId: string) =>
        sceneId === "scene-1"
          ? {
              instances: [
                placement("counter-1", "woofx3"),
                placement("spotify-1", "spotify"),
                placement("alerts", "woofx3", "alert"),
              ],
            }
          : null,
    },
    moduleState: { read },
  };
  return { deps: d as unknown as HttpDeps, read };
}

function request(instanceId: string, key: string | null, cookie = "good"): Request {
  const query = key === null ? "" : `?key=${encodeURIComponent(key)}`;
  return new Request(`http://scene.test/scene/scene-1/widget/${instanceId}/storage${query}`, {
    headers: { Cookie: `sm_session=${cookie}` },
  });
}

describe("handleWidgetStorageRoute", () => {
  it("reads the key from the storage of the placement's own module", async () => {
    const { deps: d, read } = deps();
    const resp = await handleWidgetStorageRoute(request("counter-1", KEY), "scene-1", "counter-1", d);
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ value: { value: 3, reached: {} } });
    expect(read).toHaveBeenCalledWith("scene-1", "woofx3", KEY);
  });

  it("reads through another module's placement only from that module's storage", async () => {
    const { deps: d, read } = deps();
    await handleWidgetStorageRoute(request("spotify-1", KEY), "scene-1", "spotify-1", d);
    expect(read).toHaveBeenCalledWith("scene-1", "spotify", KEY);
  });

  it("refuses a placement that is not on the scene, or one the page draws itself", async () => {
    const { deps: d, read } = deps();
    expect((await handleWidgetStorageRoute(request("nope", KEY), "scene-1", "nope", d)).status).toBe(404);
    expect((await handleWidgetStorageRoute(request("alerts", KEY), "scene-1", "alerts", d)).status).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });

  it("refuses a session for another scene", async () => {
    const { deps: d, read } = deps();
    const resp = await handleWidgetStorageRoute(request("counter-1", KEY, "bad"), "scene-1", "counter-1", d);
    expect(resp.status).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });

  it("refuses a request with no key", async () => {
    const { deps: d } = deps();
    expect((await handleWidgetStorageRoute(request("counter-1", null), "scene-1", "counter-1", d)).status).toBe(400);
  });

  it("answers 502 when storage cannot be read", async () => {
    const { deps: d } = deps({
      read: async () => {
        throw new Error("db down");
      },
    });
    expect((await handleWidgetStorageRoute(request("counter-1", KEY), "scene-1", "counter-1", d)).status).toBe(502);
  });
});
