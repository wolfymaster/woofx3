import { describe, expect, it, mock } from "bun:test";
import {
  AssetCache,
  assetInScope,
  moduleIdOfWidget,
  readAheadAssetPaths,
} from "../../public/scene-manager/asset-loader";

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

describe("moduleIdOfWidget", () => {
  it("takes the stable module id from a canonical widget id", () => {
    expect(moduleIdOfWidget("woofx3:widget:lottie")).toBe("woofx3");
    expect(moduleIdOfWidget("spotify:1.0.0:abc1234:widget:now_playing")).toBe("spotify");
    expect(moduleIdOfWidget("lottie")).toBeNull();
    expect(moduleIdOfWidget(":widget:lottie")).toBeNull();
  });
});

describe("assetInScope", () => {
  it("allows any library file and the widget's own module's files", () => {
    expect(assetInScope("/assets/user/res-1/anim.json", "woofx3")).toBe(true);
    expect(assetInScope("/assets/modules/woofx3/abc123/widgets/lottie/data.json", "woofx3")).toBe(true);
    expect(assetInScope("/assets/user/res-1/my%20file.json", "woofx3")).toBe(true);
  });

  it("refuses another module's files and anything outside storage", () => {
    expect(assetInScope("/assets/modules/other/abc123/data.json", "woofx3")).toBe(false);
    expect(assetInScope("/assets/modules/woofx3x/abc123/data.json", "woofx3")).toBe(false);
    expect(assetInScope("/assets/media/token", "woofx3")).toBe(false);
    expect(assetInScope("/scene/s1/config", "woofx3")).toBe(false);
    expect(assetInScope("/assets/user/res-1/anim.json", "")).toBe(false);
  });

  it("judges segments decoded, so none can step out", () => {
    expect(assetInScope("/assets/user/%2e%2e/modules/other/v/a.json", "woofx3")).toBe(false);
    expect(assetInScope("/assets/user/res-1/..%2F..%2Fmodules%2Fother%2Fa.json", "woofx3")).toBe(false);
    expect(assetInScope("/assets/modules/woofx3/v/..%5Cother", "woofx3")).toBe(false);
    expect(assetInScope("/assets/modules/%77oofx3/v/a.json", "woofx3")).toBe(true);
    expect(assetInScope("/assets/user/res-1/%E0%A4%A", "woofx3")).toBe(false);
    expect(assetInScope("/assets/user//anim.json", "woofx3")).toBe(false);
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
  it("reads through the engine's read route", async () => {
    const fetchFn = respond(new Response("{}", { headers: { "Content-Type": "application/json" } }));
    const cache = new AssetCache(fetchFn);

    const asset = await cache.load("/assets/user/res-1/anim.json");

    expect(new TextDecoder().decode(asset.bytes)).toBe("{}");
    expect(asset.contentType).toBe("application/json");
    expect(fetchFn.mock.calls[0]![0]).toBe("/assets/read/user/res-1/anim.json");
  });

  it("reads a file once however many ask, including a read ahead still in flight", async () => {
    const fetchFn = respond(new Response("{}"));
    const cache = new AssetCache(fetchFn);

    cache.readAhead(["/assets/user/res-1/anim.json"], "woofx3");
    const [a, b] = await Promise.all([
      cache.load("/assets/user/res-1/anim.json"),
      cache.scopedTo("woofx3")("/assets/user/res-1/anim.json"),
    ]);

    expect(a).toBe(b);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("forgets a failed read so the next ask tries again", async () => {
    const fetchFn = respond(new Error("offline"), new Response("{}"));
    const cache = new AssetCache(fetchFn);

    await expect(cache.load("/assets/user/res-1/anim.json")).rejects.toMatchObject({ code: "unavailable" });
    await cache.load("/assets/user/res-1/anim.json");

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("names a missing file not_found and a failing engine unavailable", async () => {
    const cache = new AssetCache(respond(new Response(null, { status: 404 }), new Response(null, { status: 502 })));

    await expect(cache.load("/assets/user/res-1/a.json")).rejects.toMatchObject({ code: "not_found" });
    await expect(cache.load("/assets/user/res-1/b.json")).rejects.toMatchObject({ code: "unavailable" });
  });

  it("refuses out-of-scope reads without reading, and never reads them ahead", async () => {
    const fetchFn = respond();
    const cache = new AssetCache(fetchFn);

    await expect(cache.scopedTo("woofx3")("/assets/modules/other/v/a.json")).rejects.toMatchObject({
      code: "out_of_scope",
    });
    cache.readAhead(["/assets/modules/other/v/a.json"], "woofx3");

    expect(fetchFn).not.toHaveBeenCalled();
  });
});
