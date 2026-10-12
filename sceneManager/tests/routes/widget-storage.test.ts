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

function meta(moduleId: string, hostsSurface = "") {
  return { moduleId, hostsSurface, frameUrl: "", linkedResources: {} };
}

const PUBLISHED = {
  "counter-1": meta("woofx3"),
  "spotify-1": meta("spotify"),
  alerts: meta("woofx3", "alert"),
};

type SettingRow = { key: string; value: string; valueType: string };

type Meta = ReturnType<typeof meta>;

function deps(
  opts: {
    read?: (...args: unknown[]) => Promise<unknown>;
    settings?: Record<string, SettingRow[]>;
    /** Placements held per version; the draft defaults to the published scene. */
    held?: { published?: Record<string, Meta>; draft?: Record<string, Meta> };
    snapshot?: (sceneId: string, version: string) => Promise<unknown>;
  } = {}
) {
  const read = mock(opts.read ?? (async () => ({ value: 3, reached: {} })));
  const published = opts.held?.published ?? PUBLISHED;
  const draft = opts.held?.draft ?? published;
  const d = {
    ctx: { logger },
    sessionTokens: {
      verify: async (token: string) => (token === "good" ? { sceneId: "scene-1" } : null),
    },
    sceneDocuments: {
      snapshot:
        opts.snapshot ??
        (async (sceneId: string, version: string) =>
          sceneId === "scene-1" ? { sceneId, meta: version === "draft" ? draft : published } : null),
    },
    moduleState: { read },
    settingsDb: { listModuleSettings: async (moduleId: string) => opts.settings?.[moduleId] ?? [] },
  };
  return { deps: d as unknown as HttpDeps, read };
}

function request(instanceId: string, key: string | null, cookie = "good"): Request {
  const query = key === null ? "" : `?key=${encodeURIComponent(key)}`;
  return new Request(`http://scene.test/scene/scene-1/widget/${instanceId}/storage${query}`, {
    headers: { Cookie: `sm_session_scene-1=${cookie}` },
  });
}

describe("handleWidgetStorageRoute", () => {
  it("reads the key from the storage of the placement's own module", async () => {
    const { deps: d, read } = deps();
    const resp = await handleWidgetStorageRoute(request("counter-1", KEY), "scene-1", "counter-1", d);
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ value: { value: 3, reached: {} } });
    expect(read).toHaveBeenCalledWith("scene-1", "woofx3", KEY, "woofx3");
  });

  it("reads through another module's placement only from that module's storage", async () => {
    const { deps: d, read } = deps();
    await handleWidgetStorageRoute(request("spotify-1", KEY), "scene-1", "spotify-1", d);
    expect(read).toHaveBeenCalledWith("scene-1", "spotify", KEY, "spotify");
  });

  it("reads an instance the placement's module links from the instance owner's storage", async () => {
    const { deps: d, read } = deps({
      settings: { spotify: [{ key: "counter", value: "woofx3:counter:deaths", valueType: "resource_ref" }] },
    });
    await handleWidgetStorageRoute(request("spotify-1", KEY), "scene-1", "spotify-1", d);
    expect(read).toHaveBeenCalledWith("scene-1", "woofx3", KEY, "spotify");
  });

  it("does not follow a setting that only happens to hold an instance id", async () => {
    const { deps: d, read } = deps({
      settings: { spotify: [{ key: "note", value: "woofx3:counter:deaths", valueType: "text" }] },
    });
    await handleWidgetStorageRoute(request("spotify-1", KEY), "scene-1", "spotify-1", d);
    expect(read).toHaveBeenCalledWith("scene-1", "spotify", KEY, "spotify");
  });

  it("refuses a placement that is not on the scene, or one the page draws itself", async () => {
    const { deps: d, read } = deps();
    expect((await handleWidgetStorageRoute(request("nope", KEY), "scene-1", "nope", d)).status).toBe(404);
    expect((await handleWidgetStorageRoute(request("alerts", KEY), "scene-1", "alerts", d)).status).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });

  it("reads through a placement only the draft has, as the editor's preview shows it", async () => {
    const { deps: d, read } = deps({
      held: { published: PUBLISHED, draft: { ...PUBLISHED, "timer-1": meta("woofx3") } },
    });
    const resp = await handleWidgetStorageRoute(request("timer-1", KEY), "scene-1", "timer-1", d);
    expect(resp.status).toBe(200);
    expect(read).toHaveBeenCalledWith("scene-1", "woofx3", KEY, "woofx3");
  });

  it("reads through a placement held but not yet written back to the scene", async () => {
    const { deps: d, read } = deps({ held: { published: { ...PUBLISHED, "timer-1": meta("woofx3") } } });
    const resp = await handleWidgetStorageRoute(request("timer-1", KEY), "scene-1", "timer-1", d);
    expect(resp.status).toBe(200);
    expect(read).toHaveBeenCalledWith("scene-1", "woofx3", KEY, "woofx3");
  });

  it("refuses a placement the draft draws itself", async () => {
    const { deps: d, read } = deps({
      held: { published: PUBLISHED, draft: { ...PUBLISHED, area: meta("woofx3", "alert") } },
    });
    expect((await handleWidgetStorageRoute(request("area", KEY), "scene-1", "area", d)).status).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });

  it("answers 502 when the scene cannot be loaded", async () => {
    const { deps: d, read } = deps({
      snapshot: async () => {
        throw new Error("db down");
      },
    });
    expect((await handleWidgetStorageRoute(request("counter-1", KEY), "scene-1", "counter-1", d)).status).toBe(502);
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
