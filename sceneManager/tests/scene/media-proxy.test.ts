import { describe, expect, it, mock } from "bun:test";
import type { WidgetBootPayload } from "@woofx3/module-sdk";
import { externalMediaUrl, externalMediaUrls, rewriteExternalMedia } from "../../public/scene-manager/media-url";
import { applyOps } from "../../public/scene-manager/scene-document";
import type { HttpDeps } from "../../src/http";
import { handleMediaProxyRoute, isMediaProxyPath } from "../../src/routes/media";
import { handleSceneDraftConfigRoute } from "../../src/routes/scene";
import { FrameAssembler } from "../../src/scene/frame-assembler";
import { MAX_UPSTREAM_URL_BYTES, MediaProxy } from "../../src/scene/media-proxy";
import { SceneDocuments } from "../../src/scene/scene-documents";
import type { OverlayHost, OverlaySceneState, OverlayWidgetInstance } from "../../src/scene/scene-host";

const SECRET = "test-barkloader-key";
const EXTERNAL = "https://media.example.com/clips/a.png";
// Also asserted by barkloader's media_proxy tests, so the two stay in agreement.
const EXTERNAL_PROXIED =
  "/assets/media/aHR0cHM6Ly9tZWRpYS5leGFtcGxlLmNvbS9jbGlwcy9hLnBuZw." +
  "b8c7827a7687f452745b50c64e12054167aa6a4a06c7925cd16c1db79b0ca33c";

const proxy = new MediaProxy(SECRET);
const external = (url = EXTERNAL) => ({ source: "url", name: "a.png", url, type: "image" });
const library = {
  id: "res-1",
  name: "b.png",
  url: "https://engine.example.com/assets/user/res-1/b.png",
  type: "image",
};

function logger() {
  return { debug() {}, info() {}, warn() {}, error() {} } as never;
}

describe("external media detection", () => {
  it("finds a URL value, and a value with a type but no library id", () => {
    expect(externalMediaUrl(external())).toBe(EXTERNAL);
    expect(externalMediaUrl({ url: EXTERNAL, type: "audio" })).toBe(EXTERNAL);
  });

  it("leaves library files, bare strings, relative URLs and other schemes alone", () => {
    expect(externalMediaUrl(library)).toBeNull();
    expect(externalMediaUrl(EXTERNAL)).toBeNull();
    expect(externalMediaUrl(external("/assets/media/x.y"))).toBeNull();
    expect(externalMediaUrl(external("javascript:alert(1)"))).toBeNull();
    expect(externalMediaUrl(external("data:image/png;base64,AAAA"))).toBeNull();
    expect(externalMediaUrl({ url: EXTERNAL, label: "a link" })).toBeNull();
  });

  it("rewrites values nested in lists and objects, and shares what it did not change", () => {
    const settings = { title: "hi", logo: library, rows: [{ sound: external() }, { sound: library }] };
    const rewritten = rewriteExternalMedia(settings, (url) => `proxied:${url}`);
    expect(rewritten.rows[0]!.sound.url).toBe(`proxied:${EXTERNAL}`);
    expect(rewritten.rows[1]).toBe(settings.rows[1]!);
    expect(rewritten.logo).toBe(library);
    expect(settings.rows[0]!.sound.url).toBe(EXTERNAL);
    expect(rewriteExternalMedia(settings, () => undefined)).toBe(settings);
    expect(externalMediaUrls(settings)).toEqual([EXTERNAL]);
  });
});

describe("MediaProxy", () => {
  it("signs a URL into a stable proxy URL barkloader verifies", () => {
    expect(proxy.urlFor(EXTERNAL)).toBe(EXTERNAL_PROXIED);
    expect(new MediaProxy("another-secret").urlFor(EXTERNAL)).not.toBe(EXTERNAL_PROXIED);
  });

  it("does not sign a URL longer than barkloader accepts", () => {
    const long = `https://media.example.com/${"a".repeat(MAX_UPSTREAM_URL_BYTES)}`;
    expect(proxy.urlFor(long)).toBeUndefined();
    expect(proxy.settings({ image: external(long) }).image.url).toBe(long);
  });

  it("refuses an empty secret", () => {
    expect(() => new MediaProxy("")).toThrow();
  });

  it("is idempotent: a proxied value is not rewritten again", () => {
    const once = proxy.settings({ image: external() });
    expect(once.image.url).toBe(EXTERNAL_PROXIED);
    expect(proxy.settings(once)).toBe(once);
  });

  it("rewrites the settings of every widget in a page scene config", () => {
    const scene = { id: "s1", layout: {}, widgets: [{ id: "a", settings: { image: external() } }] };
    expect(proxy.sceneConfig(scene).widgets[0]!.settings.image.url).toBe(EXTERNAL_PROXIED);
    expect(proxy.sceneConfig(null)).toBeNull();
  });
});

function instance(id: string, settings: Record<string, unknown>): OverlayWidgetInstance {
  return {
    id,
    widgetCanonicalId: "woofx3:widget:image",
    moduleId: "woofx3",
    manifestId: "image",
    position: { x: 0, y: 0, width: 100, height: 50 },
    settings,
    visible: true,
    hostsSurface: "",
    frameUrl: "/frames/woofx3/image?v=1",
    linkedResources: {},
    resolved: true,
  };
}

function documents(settings: Record<string, unknown>) {
  const state: OverlaySceneState = { sceneId: "s1", name: "Main", layout: {}, instances: [instance("a", settings)] };
  const sent: Array<{ event: string; data: any }> = [];
  const docs = new SceneDocuments(
    { loadFramedSceneById: async () => state, framePlacements: async () => [] },
    { broadcast: (_sceneId, event, data) => sent.push({ event, data }), connectedSceneIds: () => ["s1"] },
    logger(),
    { mediaProxy: proxy }
  );
  return { docs, sent };
}

describe("SceneDocuments — what overlays see", () => {
  it("gives overlays the snapshot with external media proxied, and editors the values as entered", async () => {
    const { docs } = documents({ image: external(), logo: library });
    const overlay = await docs.overlaySnapshot("s1");
    expect(overlay!.doc.widgets.a!.settings).toEqual({
      image: { ...external(), url: EXTERNAL_PROXIED },
      logo: library,
    });
    expect((await docs.snapshot("s1"))!.doc.widgets.a!.settings.image).toEqual(external());
  });

  it("sends overlays live settings edits that apply to their proxied document", async () => {
    const { docs, sent } = documents({ image: external() });
    const overlayBefore = await docs.overlaySnapshot("s1");
    const next = "https://media.example.com/clips/b.png";
    // An edit inside the url string, as a text field makes it.
    const result = await docs.submit("s1", "published", 0, [
      { p: ["widgets", "a", "settings", "image", "url", 32], sd: "a" },
      { p: ["widgets", "a", "settings", "image", "url", 32], si: "b" },
    ]);
    expect(result.ok).toBe(true);
    const pushed = sent.find((s) => s.event === "scene-ops" && s.data.version === "published")!.data;
    const overlayAfter = applyOps(overlayBefore!.doc, pushed.ops);
    expect(overlayAfter.widgets.a!.settings.image).toEqual({ ...external(next), url: proxy.urlFor(next) });
    expect(overlayAfter).toEqual((await docs.overlaySnapshot("s1"))!.doc);
  });

  it("sends ops that do not touch settings as they were made", async () => {
    const { docs, sent } = documents({ image: external() });
    await docs.snapshot("s1");
    const ops = [{ p: ["widgets", "a", "x"], od: 0, oi: 10 }];
    await docs.submit("s1", "published", 0, ops);
    expect(sent.find((s) => s.data.version === "published")!.data.ops).toEqual(ops);
  });
});

describe("FrameAssembler — alert widgets", () => {
  it("proxies external media in an alert widget's boot settings", async () => {
    const delivery = {
      alertId: "alert-1",
      layout: {
        width: 100,
        height: 100,
        widgets: [
          {
            id: "t1",
            widgetCanonicalId: "woofx3:widget:image",
            moduleId: "woofx3",
            manifestId: "image",
            position: { x: 0, y: 0, width: 10, height: 10 },
            settings: { image: external(), logo: library },
          },
        ],
      },
      event: null,
    };
    const host = { loadSceneEvent: async () => ({ type: "alert", value: delivery }) } as unknown as OverlayHost;
    const assembler = new FrameAssembler(host, logger(), {
      barkloader: {
        fetchWidgetFrame: async () => ({
          entryHtml: "<!doctype html><html><head></head><body></body></html>",
          resourceBaseUrl: "https://engine.example.com/assets/modules/woofx3/h/widgets/image/",
          theme: null,
        }),
      },
      mediaProxy: proxy,
    });
    const html = await (await assembler.assembleAlertWidget("s1", "evt-1", "t1", null)).text();
    const boot: WidgetBootPayload = JSON.parse(/window\.__WOOFX3_WIDGET_BOOT__ = (.*?);<\/script>/.exec(html)![1]!);
    expect(boot.settings).toEqual({ image: { ...external(), url: EXTERNAL_PROXIED }, logo: library });
  });
});

describe("handleSceneDraftConfigRoute — media", () => {
  it("proxies the draft's external media and maps each URL to its proxy URL", async () => {
    const buildDraftConfig = mock(async (_sceneId: string, widgets: unknown[]) => ({
      scene: { id: "s1", name: "Main", layout: {}, widgets },
    }));
    const deps = {
      sessionTokens: { verify: async () => ({ sceneId: "s1" }) },
      host: { buildDraftConfig },
      mediaProxy: proxy,
    } as unknown as HttpDeps;
    const widgets = [{ id: "a", settings: { image: external() } }];
    const resp = await handleSceneDraftConfigRoute(
      new Request("http://scene.test/scene/s1/draft-config", {
        method: "POST",
        headers: { Cookie: "sm_session_s1=good" },
        body: JSON.stringify({ widgets }),
      }),
      "s1",
      deps
    );
    const body = await resp.json();
    expect(body.scene.widgets[0].settings.image.url).toBe(EXTERNAL_PROXIED);
    expect(body.mediaUrls).toEqual({ [EXTERNAL]: EXTERNAL_PROXIED });
  });
});

describe("handleMediaProxyRoute", () => {
  it("matches only a single token segment under the media path", () => {
    expect(isMediaProxyPath(EXTERNAL_PROXIED)).toBe(true);
    expect(isMediaProxyPath("/assets/media/")).toBe(false);
    expect(isMediaProxyPath("/assets/media/a/b")).toBe(false);
  });

  it("forwards Range and relays a partial response with its headers", async () => {
    const fetchFn = mock(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Range")).toBe("bytes=10-19");
      expect(headers.get("Cookie")).toBeNull();
      return new Response("0123456789", {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Range": "bytes 10-19/100",
          "Accept-Ranges": "bytes",
          "X-Content-Type-Options": "nosniff",
          "Set-Cookie": "a=b",
        },
      });
    });
    const url = new URL(`http://scene.test${EXTERNAL_PROXIED}`);
    const req = new Request(url, { headers: { Range: "bytes=10-19", Cookie: "sm_session_s1=x" } });
    const resp = await handleMediaProxyRoute(req, url, "http://barkloader.test/", logger(), fetchFn as never);
    expect(fetchFn.mock.calls[0]![0]).toBe(`http://barkloader.test${EXTERNAL_PROXIED}`);
    expect(resp.status).toBe(206);
    expect(resp.headers.get("Content-Range")).toBe("bytes 10-19/100");
    expect(resp.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(resp.headers.get("Set-Cookie")).toBeNull();
    expect(await resp.text()).toBe("0123456789");
  });

  it("refuses methods other than GET", async () => {
    const url = new URL(`http://scene.test${EXTERNAL_PROXIED}`);
    const resp = await handleMediaProxyRoute(new Request(url, { method: "POST" }), url, "http://b", logger());
    expect(resp.status).toBe(405);
  });
});
