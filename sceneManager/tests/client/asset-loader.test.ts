import { describe, expect, it, mock } from "bun:test";
import { AssetCache, readAheadAssetPaths } from "../../public/scene-manager/asset-loader";

const ORIGIN = "http://scene.test";

function respond(...responses: Array<Response | Error>) {
  return mock(async (_url: string, _init: RequestInit) => {
    const next = responses.shift();
    if (next === undefined) {
      throw new Error("unexpected read");
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  });
}

describe("AssetCache.loaderFor", () => {
  const json = () => new Response("{}", { headers: { "Content-Type": "application/json" } });
  const allowed = async (path: string, moduleId: string) => {
    const cache = new AssetCache({ pageOrigin: ORIGIN, fetchFn: respond(json()) });
    return cache
      .loaderFor(moduleId)(path)
      .then(
        () => true,
        (err) => {
          expect(err.code).toBe("out_of_scope");
          return false;
        }
      );
  };

  it("reads any library file and the widget's own module's files, from the read route", async () => {
    const fetchFn = respond(json());
    await new AssetCache({ pageOrigin: ORIGIN, fetchFn }).loaderFor("woofx3")("/assets/user/res-1/my%20file.json");
    expect(fetchFn.mock.calls[0]![0]).toBe("/assets/read/user/res-1/my%20file.json");
    expect(await allowed("/assets/modules/woofx3/abc123/widgets/lottie/data.json", "woofx3")).toBe(true);
    expect(await allowed("/assets/modules/%77oofx3/v/a.json", "woofx3")).toBe(true);
  });

  it("refuses another module's files, anything outside storage, and paths that step out", async () => {
    for (const path of [
      "/assets/modules/other/abc123/data.json",
      "/assets/modules/woofx3x/abc123/data.json",
      "/assets/media/token",
      "/scene/s1/config",
      "/assets/user/%2e%2e/modules/other/v/a.json",
      "/assets/user/res-1/..%2F..%2Fmodules%2Fother%2Fa.json",
      "/assets/modules/woofx3/v/..%5Cother",
      "/assets/user//anim.json",
    ]) {
      expect(await allowed(path, "woofx3")).toBe(false);
    }
    expect(await allowed("/assets/user/res-1/anim.json", "")).toBe(false);
  });
});

describe("readAheadAssetPaths", () => {
  it("finds library files a script reads, anywhere in the settings", () => {
    const settings = {
      src: {
        id: "res-1",
        name: "bit_overlay.json",
        url: `${ORIGIN}/assets/user/res-1/bit_overlay.json`,
        type: "application/json",
      },
      nested: [{ file: { id: "res-2", name: "a", url: "https://engine.test/assets/user/res-2/a.csv", type: "other" } }],
    };
    expect(readAheadAssetPaths(settings, ORIGIN)).toEqual([
      "/assets/user/res-1/bit_overlay.json",
      "/assets/user/res-2/a.csv",
    ]);
  });

  it("leaves files an element loads, files hosted elsewhere, and plain strings", () => {
    const settings = {
      image: { id: "res-1", name: "a.png", url: `${ORIGIN}/assets/user/res-1/a.png`, type: "image/png" },
      sound: { id: "res-2", name: "a.mp3", url: `${ORIGIN}/assets/user/res-2/a.mp3`, type: "audio" },
      external: { source: "url", name: "a.json", url: "https://cdn.test/a.json", type: "other" },
      bare: `${ORIGIN}/assets/user/res-3/a.json`,
    };
    expect(readAheadAssetPaths(settings, ORIGIN)).toEqual([]);
  });
});

describe("AssetCache", () => {
  it("calls the default fetch with a global receiver (browser Illegal-invocation regression)", async () => {
    // The browser rejects `fetch` invoked with any `this` other than the
    // global, which the read would report as "unavailable" with no request
    // sent. Bun's fetch has no such check, so the guard is modeled here.
    const original = globalThis.fetch;
    const receivers: unknown[] = [];
    globalThis.fetch = function (this: unknown) {
      receivers.push(this);
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("'fetch' called on an object that does not implement interface Window.");
      }
      return Promise.resolve(new Response("{}", { headers: { "Content-Type": "application/json" } }));
    } as unknown as typeof fetch;

    try {
      const asset = await new AssetCache({ pageOrigin: ORIGIN }).load("/assets/user/res-1/anim.json");
      expect(receivers).toEqual([globalThis]);
      expect(new TextDecoder().decode(asset.bytes)).toBe("{}");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("reads through the engine's read route", async () => {
    const fetchFn = respond(new Response("{}", { headers: { "Content-Type": "application/json" } }));
    const cache = new AssetCache({ pageOrigin: ORIGIN, fetchFn });

    const asset = await cache.load("/assets/user/res-1/anim.json");

    expect(new TextDecoder().decode(asset.bytes)).toBe("{}");
    expect(asset.contentType).toBe("application/json");
    expect(fetchFn.mock.calls[0]![0]).toBe("/assets/read/user/res-1/anim.json");
  });

  it("reads a file once however many ask, including a read ahead still in flight", async () => {
    const fetchFn = respond(new Response("{}"));
    const cache = new AssetCache({ pageOrigin: ORIGIN, fetchFn });

    cache.warm("woofx3", { src: { id: "res-1", url: "/assets/user/res-1/anim.json", type: "application/json" } });
    const [a, b] = await Promise.all([
      cache.load("/assets/user/res-1/anim.json"),
      cache.loaderFor("woofx3")("/assets/user/res-1/anim.json"),
    ]);

    expect(a).toBe(b);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("forgets a failed read so the next ask tries again", async () => {
    const fetchFn = respond(new Error("offline"), new Response("{}"));
    const cache = new AssetCache({ pageOrigin: ORIGIN, fetchFn });

    await expect(cache.load("/assets/user/res-1/anim.json")).rejects.toMatchObject({ code: "unavailable" });
    await cache.load("/assets/user/res-1/anim.json");

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("names a missing file not_found and a failing engine unavailable", async () => {
    const cache = new AssetCache({
      pageOrigin: ORIGIN,
      fetchFn: respond(new Response(null, { status: 404 }), new Response(null, { status: 502 })),
    });

    await expect(cache.load("/assets/user/res-1/a.json")).rejects.toMatchObject({ code: "not_found" });
    await expect(cache.load("/assets/user/res-1/b.json")).rejects.toMatchObject({ code: "unavailable" });
  });

  it("refuses out-of-scope reads without reading, and never reads them ahead", async () => {
    const fetchFn = respond();
    const cache = new AssetCache({ pageOrigin: ORIGIN, fetchFn });

    await expect(cache.loaderFor("woofx3")("/assets/modules/other/v/a.json")).rejects.toMatchObject({
      code: "out_of_scope",
    });
    cache.warm("woofx3", { src: { id: "x", url: "/assets/modules/other/v/a.json", type: "application/json" } });

    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("AssetCache retention", () => {
  const json = () => new Response("{}", { headers: { "Content-Type": "application/json" } });

  it("serves asks within the retain window from one read", async () => {
    const fetchFn = respond(json());
    const cache = new AssetCache({ pageOrigin: ORIGIN, fetchFn, retainMs: 50 });
    await cache.load("/assets/user/res-1/anim.json");
    await cache.load("/assets/user/res-1/anim.json");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("lets go of a file after the window, so the next ask reads it again", async () => {
    const fetchFn = respond(json(), json());
    const cache = new AssetCache({ pageOrigin: ORIGIN, fetchFn, retainMs: 5 });
    await cache.load("/assets/user/res-1/anim.json");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(cache.size()).toBe(0);
    await cache.load("/assets/user/res-1/anim.json");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe("a frame whose module is not known", () => {
  it("may read nothing and is warmed nothing", async () => {
    const fetchFn = respond();
    const cache = new AssetCache({ pageOrigin: ORIGIN, fetchFn });
    cache.warm(null, { src: { id: "res-1", url: "/assets/user/res-1/anim.json", type: "application/json" } });
    await expect(cache.loaderFor(null)("/assets/user/res-1/anim.json")).rejects.toMatchObject({ code: "out_of_scope" });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
