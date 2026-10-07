import { describe, expect, it, mock } from "bun:test";
import { MediaCache } from "../../public/scene-manager/media-cache";

const PAGE = "http://scene.test/scene/scene-1";
const SOUND_URL = "https://public.example.test/assets/user/r1/air%20horn.mp3";
const SOUND_MEDIA_URL = "http://scene.test/scene/scene-1/media/user/r1/air%20horn.mp3";

/** An in-memory stand-in for the Cache API, keyed by URL. */
function fakeCacheStorage() {
  const entries = new Map<string, Blob>();
  const cache = {
    async match(url: string) {
      const blob = entries.get(url);
      return blob ? new Response(blob) : undefined;
    },
    async put(url: string, response: Response) {
      entries.set(url, await response.blob());
    },
    async keys() {
      return [...entries.keys()].map((url) => new Request(url));
    },
    async delete(request: Request) {
      return entries.delete(request.url);
    },
  };
  return { entries, storage: { open: async () => cache } as unknown as CacheStorage };
}

function cacheWith(opts: { fetchFn?: typeof fetch; cacheStorage?: CacheStorage | null; maxMemoryBytes?: number } = {}) {
  const fetchFn = mock(
    opts.fetchFn ?? (async () => new Response("abc", { headers: { "Content-Type": "audio/mpeg" } }))
  );
  const media = new MediaCache({
    sceneId: "scene-1",
    sceneBase: "/scene/scene-1",
    pageUrl: PAGE,
    fetchFn: fetchFn as unknown as unknown as typeof fetch,
    cacheStorage: opts.cacheStorage ?? null,
    maxMemoryBytes: opts.maxMemoryBytes,
  });
  return { media, fetchFn };
}

describe("MediaCache", () => {
  it("fetches an engine asset URL through the scene's media route", async () => {
    const { media, fetchFn } = cacheWith();
    const blob = await media.load(SOUND_URL);
    expect(await blob!.text()).toBe("abc");
    expect(fetchFn).toHaveBeenCalledWith(SOUND_MEDIA_URL, { credentials: "same-origin" });
  });

  it("does not serve a URL that is not engine media", async () => {
    const { media, fetchFn } = cacheWith();
    expect(await media.load("https://cdn.example.test/sound.mp3")).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("fetches a file once, however many widgets ask and whenever", async () => {
    const { media, fetchFn } = cacheWith();
    const [a, b] = await Promise.all([media.load(SOUND_URL), media.load(SOUND_URL)]);
    const c = await media.load(SOUND_URL);
    expect(a).toBe(b);
    expect(c).toBe(a);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("answers null for a refused fetch, and fetches again on the next ask", async () => {
    let status = 413;
    const { media, fetchFn } = cacheWith({
      fetchFn: (async () => new Response("abc", { status })) as unknown as typeof fetch,
    });
    expect(await media.load(SOUND_URL)).toBeNull();
    status = 200;
    expect(await (await media.load(SOUND_URL))!.text()).toBe("abc");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("serves a reloaded page from the Cache API without fetching", async () => {
    const { entries, storage } = fakeCacheStorage();
    await cacheWith({ cacheStorage: storage }).media.load(SOUND_URL);
    expect([...entries.keys()]).toEqual([SOUND_MEDIA_URL]);

    const reloaded = cacheWith({ cacheStorage: storage });
    expect(await (await reloaded.media.load(SOUND_URL))!.text()).toBe("abc");
    expect(reloaded.fetchFn).not.toHaveBeenCalled();
  });

  it("prunes persisted files the scene's manifest no longer lists", async () => {
    const { entries, storage } = fakeCacheStorage();
    const { media } = cacheWith({ cacheStorage: storage });
    await media.prefetch(["user/r1/air horn.mp3", "user/r2/old.mp3"]);
    await media.prune(["user/r1/air horn.mp3"]);
    expect([...entries.keys()]).toEqual([SOUND_MEDIA_URL]);
  });

  it("lets the least recently used file go past the memory limit", async () => {
    const { media, fetchFn } = cacheWith({
      fetchFn: (async () => new Response(new Uint8Array(6))) as unknown as typeof fetch,
      maxMemoryBytes: 10,
    });
    await media.get("user/a/x");
    await media.get("user/b/x");
    await media.get("user/b/x");
    await media.get("user/a/x");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});
