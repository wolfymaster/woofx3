import { describe, expect, it, mock } from "bun:test";
import type { HttpDeps } from "../../src/http";
import {
  handleSceneMediaManifestRoute,
  handleSceneMediaRoute,
  MAX_MEDIA_BYTES,
  mediaKeyOfPath,
} from "../../src/routes/media";

const logger = {
  debug: mock(() => undefined),
  info: mock(() => undefined),
  warn: mock(() => undefined),
  error: mock(() => undefined),
};

function deps(opts: { workflows?: () => Promise<string[]> } = {}): HttpDeps {
  return {
    ctx: { logger, runtimeConfig: { barkloaderUrl: "http://barkloader.test/" } },
    sessionTokens: {
      verify: async (token: string) => (token === "good" ? { sceneId: "scene-1" } : null),
    },
    host: {
      loadSceneById: async (sceneId: string) =>
        sceneId === "scene-1"
          ? {
              instances: [
                {
                  id: "alerts",
                  moduleId: "woofx3",
                  hostsSurface: "alert",
                  settings: {},
                },
              ],
            }
          : null,
    },
    workflows: {
      listEnabledWorkflowSteps:
        opts.workflows ??
        (async () => [
          JSON.stringify([
            {
              id: "a",
              type: "action",
              action: "alert",
              parameters: {
                layout: { widgets: [{ settings: { src: { url: "https://s.test/assets/user/r1/horn.mp3" } } }] },
              },
            },
          ]),
        ]),
    },
  } as unknown as HttpDeps;
}

function request(path: string, cookie = "good"): Request {
  return new Request(`http://scene.test/scene/scene-1${path}`, {
    headers: { Cookie: `sm_session_scene-1=${cookie}` },
  });
}

describe("handleSceneMediaManifestRoute", () => {
  it("lists the media the scene's alert widgets can be asked to play", async () => {
    const resp = await handleSceneMediaManifestRoute(request("/media-manifest"), "scene-1", deps());
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ keys: ["user/r1/horn.mp3"] });
  });

  it("lists only the placements' media when workflows cannot be read", async () => {
    const d = deps({
      workflows: async () => {
        throw new Error("db down");
      },
    });
    const resp = await handleSceneMediaManifestRoute(request("/media-manifest"), "scene-1", d);
    expect(await resp.json()).toEqual({ keys: [] });
  });

  it("refuses a request without the scene's session", async () => {
    const resp = await handleSceneMediaManifestRoute(request("/media-manifest", "bad"), "scene-1", deps());
    expect(resp.status).toBe(401);
  });
});

describe("handleSceneMediaRoute", () => {
  it("streams the asset from barkloader, following a storage redirect", async () => {
    const fetchFn = mock(
      async () =>
        new Response("bytes", { status: 200, headers: { "Content-Type": "audio/mpeg", "Content-Length": "5" } })
    );
    const resp = await handleSceneMediaRoute(
      request("/media/user/r1/air%20horn.mp3"),
      "scene-1",
      "user/r1/air%20horn.mp3",
      deps(),
      fetchFn as unknown as typeof fetch
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(await resp.text()).toBe("bytes");
    expect(fetchFn).toHaveBeenCalledWith("http://barkloader.test/assets/user/r1/air%20horn.mp3", {
      method: "GET",
      redirect: "follow",
    });
  });

  it("refuses a file larger than the page caches", async () => {
    const fetchFn = async () =>
      new Response("x", { status: 200, headers: { "Content-Length": String(MAX_MEDIA_BYTES + 1) } });
    const resp = await handleSceneMediaRoute(
      request("/media/user/r1/big.mp4"),
      "scene-1",
      "user/r1/big.mp4",
      deps(),
      fetchFn as unknown as typeof fetch
    );
    expect(resp.status).toBe(413);
  });

  it("answers 404 for a missing asset and for a key it does not serve", async () => {
    const fetchFn = mock(async () => new Response(null, { status: 404 }));
    const missing = await handleSceneMediaRoute(
      request("/media/user/r1/gone.mp3"),
      "scene-1",
      "user/r1/gone.mp3",
      deps(),
      fetchFn as unknown as typeof fetch
    );
    expect(missing.status).toBe(404);

    const bundle = await handleSceneMediaRoute(
      request("/media/modules/m/abc/widgets/w/index.html"),
      "scene-1",
      "modules/m/abc/widgets/w/index.html",
      deps(),
      fetchFn as unknown as typeof fetch
    );
    expect(bundle.status).toBe(404);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refuses a request without the scene's session", async () => {
    const fetchFn = mock(async () => new Response("bytes"));
    const resp = await handleSceneMediaRoute(
      request("/media/user/r1/horn.mp3", "bad"),
      "scene-1",
      "user/r1/horn.mp3",
      deps(),
      fetchFn as unknown as typeof fetch
    );
    expect(resp.status).toBe(401);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("mediaKeyOfPath", () => {
  it("decodes each segment and rejects traversal", () => {
    expect(mediaKeyOfPath("user/r1/air%20horn.mp3")).toBe("user/r1/air horn.mp3");
    expect(mediaKeyOfPath("user/r1/..%2F..%2Fsecret")).toBeNull();
    expect(mediaKeyOfPath("other/r1/x")).toBeNull();
    expect(mediaKeyOfPath("user/r1/%E0%A4%A")).toBeNull();
  });
});
