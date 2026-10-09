import { describe, expect, it, mock } from "bun:test";
import type { WidgetBootPayload } from "@woofx3/module-sdk";
import {
  earliestMediaProxyExpiry,
  externalMediaUrl,
  externalMediaUrls,
  mediaProxyExpiry,
  parseMediaUrls,
  rewriteExternalMedia,
} from "../../public/scene-manager/media-url";
import { applyOps, type PlacementMeta } from "../../public/scene-manager/scene-document";
import { corsHeadersFor, type HttpDeps } from "../../src/http";
import { handleMediaProxyRoute, isMediaProxyPath } from "../../src/routes/media";
import { handleSceneDraftConfigRoute } from "../../src/routes/scene";
import { FrameAssembler } from "../../src/scene/frame-assembler";
import { FrameCatalog } from "../../src/scene/frame-catalog";
import {
  MAX_UPSTREAM_URL_BYTES,
  MEDIA_TOKEN_LIFETIME_SECONDS,
  MEDIA_TOKEN_STEP_SECONDS,
  MediaProxy,
  mediaProxyBaseOf,
} from "../../src/scene/media-proxy";
import { SceneDocuments } from "../../src/scene/scene-documents";
import type { OverlayHost, OverlaySceneState, OverlayWidgetInstance } from "../../src/scene/scene-host";
import type { FrameTheme } from "../../src/scene/widget-theme";

const SECRET = "test-barkloader-key";
const EXTERNAL = "https://media.example.com/clips/a.png";
const EXPIRES_AT = 1_700_006_400;
// Also asserted by barkloader's media_proxy tests, so the two stay in agreement.
const EXTERNAL_TOKEN =
  "aHR0cHM6Ly9tZWRpYS5leGFtcGxlLmNvbS9jbGlwcy9hLnBuZw.1700006400." +
  "0177fbe16b336d0a520eeeb2f31e4722d7cd99e96596233f1562fce6115e1bfd";
const RESOURCE_BASE = "https://engine.example.com/assets/modules/woofx3/h/widgets/timer/";
const BASE = "https://engine.example.com/assets/media/";
const EXTERNAL_PROXIED = `${BASE}${EXTERNAL_TOKEN}`;
/** The moment from which a minted token expires exactly at `EXPIRES_AT`. */
const NOW_MS = (EXPIRES_AT - MEDIA_TOKEN_LIFETIME_SECONDS) * 1000;

const proxy = new MediaProxy(SECRET, () => NOW_MS);
const external = (url = EXTERNAL) => ({ source: "url", name: "a.png", url, type: "image" });
const library = {
  id: "res-1",
  name: "b.png",
  url: "https://engine.example.com/assets/user/res-1/b.png",
  type: "image",
};
const THEME: FrameTheme = {
  id: null,
  contractVersion: 1,
  variables: {},
  assets: {},
  defaultAssets: {},
  fallback: null,
  stylesheetUrl: null,
};

function logger() {
  return { debug() {}, info() {}, warn() {}, error() {} } as never;
}

describe("external media detection", () => {
  it("finds a value the picker stored for a URL, over https or http", () => {
    expect(externalMediaUrl(external())).toBe(EXTERNAL);
    expect(externalMediaUrl(external("http://media.example.com/a.png"))).toBe("http://media.example.com/a.png");
  });

  it("leaves library files, unmarked objects, bare strings, relative URLs and other schemes alone", () => {
    expect(externalMediaUrl(library)).toBeNull();
    expect(externalMediaUrl({ url: EXTERNAL, type: "audio" })).toBeNull();
    expect(externalMediaUrl({ url: EXTERNAL, label: "a link" })).toBeNull();
    expect(externalMediaUrl(EXTERNAL)).toBeNull();
    expect(externalMediaUrl(external("/assets/media/x.y"))).toBeNull();
    expect(externalMediaUrl(external("javascript:alert(1)"))).toBeNull();
    expect(externalMediaUrl(external("data:image/png;base64,AAAA"))).toBeNull();
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

describe("media proxy URLs on the page", () => {
  it("reads a proxy URL's expiry, and nothing from other URLs", () => {
    expect(mediaProxyExpiry(EXTERNAL_PROXIED)).toBe(EXPIRES_AT);
    expect(mediaProxyExpiry(`https://host.example/engine/assets/media/${EXTERNAL_TOKEN}`)).toBe(EXPIRES_AT);
    expect(mediaProxyExpiry(EXTERNAL)).toBeNull();
    expect(mediaProxyExpiry(`${BASE}payload.soon.sig`)).toBeNull();
    expect(mediaProxyExpiry(`${BASE}payload.sig`)).toBeNull();
    expect(mediaProxyExpiry("not a url")).toBeNull();
  });

  it("finds the soonest expiry in a placement's settings", () => {
    const later = new MediaProxy(SECRET, () => NOW_MS + 3 * MEDIA_TOKEN_STEP_SECONDS * 1000);
    const settings = {
      a: { ...external(), url: later.urlFor(EXTERNAL, BASE) },
      b: { ...external(), url: EXTERNAL_PROXIED },
      c: library,
    };
    expect(earliestMediaProxyExpiry(settings)).toBe(EXPIRES_AT);
    expect(earliestMediaProxyExpiry({ c: library, d: external() })).toBeNull();
  });

  it("parses a draft answer's media URLs by placement, dropping anything malformed", () => {
    const parsed = parseMediaUrls({ a: { [EXTERNAL]: EXTERNAL_PROXIED, bad: 1 }, b: "nope", c: {} });
    expect([...parsed.keys()]).toEqual(["a", "c"]);
    expect([...parsed.get("a")!.entries()]).toEqual([[EXTERNAL, EXTERNAL_PROXIED]]);
    expect(parseMediaUrls(null).size).toBe(0);
  });
});

describe("mediaProxyBaseOf", () => {
  it("is the media path under barkloader's public URL, path prefix included", () => {
    expect(mediaProxyBaseOf(RESOURCE_BASE)).toBe(BASE);
    expect(mediaProxyBaseOf("https://host.example/engine/assets/modules/woofx3/h/widgets/timer/")).toBe(
      "https://host.example/engine/assets/media/"
    );
  });

  it("is null for a base that is not barkloader's layout", () => {
    expect(mediaProxyBaseOf("https://engine.example.com/widgets/timer/")).toBeNull();
    expect(mediaProxyBaseOf("not a url")).toBeNull();
  });
});

describe("MediaProxy", () => {
  it("signs a URL into the proxy URL barkloader verifies", () => {
    expect(proxy.urlFor(EXTERNAL, BASE)).toBe(EXTERNAL_PROXIED);
    expect(new MediaProxy("another-secret", () => NOW_MS).urlFor(EXTERNAL, BASE)).not.toBe(EXTERNAL_PROXIED);
  });

  it("hands out one URL per upstream URL within a step, good for at least the lifetime", () => {
    for (const offset of [0, 1, MEDIA_TOKEN_STEP_SECONDS - 1]) {
      const at = new MediaProxy(SECRET, () => NOW_MS - offset * 1000);
      expect(at.urlFor(EXTERNAL, BASE)).toBe(EXTERNAL_PROXIED);
      expect(at.expiresAt() - (NOW_MS / 1000 - offset)).toBeGreaterThanOrEqual(MEDIA_TOKEN_LIFETIME_SECONDS);
    }
    const nextStep = new MediaProxy(SECRET, () => NOW_MS + 1000);
    expect(nextStep.expiresAt()).toBe(EXPIRES_AT + MEDIA_TOKEN_STEP_SECONDS);
  });

  it("keeps the public URL's path prefix", () => {
    const prefixed = "https://host.example/engine/assets/media/";
    expect(proxy.urlFor(EXTERNAL, prefixed)).toBe(`${prefixed}${EXTERNAL_TOKEN}`);
  });

  it("leaves a URL already on the proxy's origin, and one longer than barkloader accepts", () => {
    expect(proxy.urlFor("https://engine.example.com/clips/a.png", BASE)).toBeUndefined();
    const long = `https://media.example.com/${"a".repeat(MAX_UPSTREAM_URL_BYTES)}`;
    expect(proxy.urlFor(long, BASE)).toBeUndefined();
    expect(proxy.settings({ image: external(long) }, BASE).image.url).toBe(long);
  });

  it("refuses an empty secret", () => {
    expect(() => new MediaProxy("")).toThrow();
  });

  it("does not rewrite a proxied value again", () => {
    const once = proxy.settings({ image: external() }, BASE);
    expect(once.image.url).toBe(EXTERNAL_PROXIED);
    expect(proxy.settings(once, BASE)).toBe(once);
  });

  it("signs only what `signable` allows", () => {
    const other = "https://media.example.com/clips/b.png";
    const settings = { a: external(), b: external(other) };
    const signable = (url: string) => url === EXTERNAL;
    expect(proxy.settings(settings, BASE, signable)).toEqual({
      a: { ...external(), url: EXTERNAL_PROXIED },
      b: external(other),
    });
    expect(proxy.urlsIn(settings, BASE, signable)).toEqual({ [EXTERNAL]: EXTERNAL_PROXIED });
  });

  it("rewrites only the widgets of a page scene config that have a media proxy base", () => {
    const scene = {
      id: "s1",
      layout: {},
      widgets: [
        { id: "themed", settings: { image: external() }, mediaProxyBase: BASE },
        { id: "plain", settings: { image: external() } },
      ],
    };
    const view = proxy.sceneConfig(scene);
    expect(view.widgets[0]!.settings.image.url).toBe(EXTERNAL_PROXIED);
    expect(view.widgets[1]).toBe(scene.widgets[1]!);
    expect(proxy.sceneConfig(null)).toBeNull();
  });
});

function instance(id: string, settings: Record<string, unknown>, themeable: boolean): OverlayWidgetInstance {
  return {
    id,
    widgetCanonicalId: themeable ? "woofx3:widget:timer" : "woofx3:widget:image",
    moduleId: "woofx3",
    manifestId: themeable ? "timer" : "image",
    position: { x: 0, y: 0, width: 100, height: 50 },
    settings,
    visible: true,
    hostsSurface: "",
    frameUrl: "/frames/woofx3/image?v=1",
    linkedResources: {},
    ...(themeable ? { mediaProxyBase: BASE } : {}),
    resolved: true,
  };
}

function documents(instances: OverlayWidgetInstance[], framed: OverlayWidgetInstance[] = []) {
  const state: OverlaySceneState = { sceneId: "s1", name: "Main", layout: {}, instances };
  const sent: Array<{ event: string; data: any }> = [];
  const docs = new SceneDocuments(
    { loadFramedSceneById: async () => state, framePlacements: async () => framed },
    { broadcast: (_sceneId, event, data) => sent.push({ event, data }), connectedSceneIds: () => ["s1"] },
    logger(),
    { mediaProxy: proxy }
  );
  const pushed = () => sent.filter((s) => s.event === "scene-ops" && s.data.version === "published").at(-1)!.data;
  return { docs, pushed };
}

describe("SceneDocuments — what overlays see", () => {
  it("proxies external media for themeable placements only, and gives editors the values as entered", async () => {
    const { docs } = documents([
      instance("themed", { image: external(), logo: library }, true),
      instance("plain", { image: external() }, false),
    ]);
    const overlay = await docs.overlaySnapshot("s1");
    expect(overlay!.doc.widgets.themed!.settings).toEqual({
      image: { ...external(), url: EXTERNAL_PROXIED },
      logo: library,
    });
    expect(overlay!.doc.widgets.plain!.settings.image).toEqual(external());
    expect((await docs.snapshot("s1"))!.doc.widgets.themed!.settings.image).toEqual(external());
  });

  it("sends a themeable placement's settings edit whole, so it applies to the overlay's view", async () => {
    const { docs, pushed } = documents([instance("themed", { image: external() }, true)]);
    const overlayBefore = await docs.overlaySnapshot("s1");
    const next = "https://media.example.com/clips/b.png";
    // An edit inside the url string, as a text field makes it.
    const result = await docs.submit("s1", "published", 0, [
      { p: ["widgets", "themed", "settings", "image", "url", 32], sd: "a" },
      { p: ["widgets", "themed", "settings", "image", "url", 32], si: "b" },
    ]);
    expect(result.ok).toBe(true);
    const ops = pushed().ops;
    expect(ops).toHaveLength(1);
    expect(ops[0].p).toEqual(["widgets", "themed"]);
    const overlayAfter = applyOps(overlayBefore!.doc, ops);
    expect(overlayAfter.widgets.themed!.settings.image).toEqual({
      ...external(next),
      url: proxy.urlFor(next, BASE),
    });
    expect(overlayAfter).toEqual((await docs.overlaySnapshot("s1"))!.doc);
  });

  it("sends ops as made for placements whose view is not rewritten, and for the layout", async () => {
    const { docs, pushed } = documents([
      instance("themed", { image: external() }, true),
      instance("plain", { image: external() }, false),
      instance("text", { text: "hi" }, true),
    ]);
    await docs.snapshot("s1");
    const ops = [
      { p: ["widgets", "plain", "settings", "image", "url", 32], sd: "a" },
      { p: ["widgets", "text", "settings", "text"], od: "hi", oi: "yo" },
      { p: ["layout", "background"], oi: "#000" },
    ];
    await docs.submit("s1", "published", 0, ops);
    expect(pushed().ops).toEqual(ops);
  });

  it("resends only the touched themeable placement, leaving the other ops as made", async () => {
    const { docs, pushed } = documents([
      instance("themed", { image: external() }, true),
      instance("other", { image: external() }, false),
    ]);
    await docs.snapshot("s1");
    const move = { p: ["widgets", "other", "x"], od: 0, oi: 10 };
    await docs.submit("s1", "published", 0, [{ p: ["widgets", "themed", "x"], od: 0, oi: 5 }, move]);
    const ops = pushed().ops;
    expect(ops).toHaveLength(2);
    expect(ops[0]).toEqual(move);
    expect(ops[1].p).toEqual(["widgets", "themed"]);
    expect(ops[1].oi.x).toBe(5);
    expect(ops[1].oi.settings.image.url).toBe(EXTERNAL_PROXIED);
  });

  it("proxies a new placement's media when it is inserted", async () => {
    const { docs, pushed } = documents([], [instance("added", { image: external() }, true)]);
    expect((await docs.snapshot("s1"))!.doc.widgets).toEqual({});
    const placement = {
      widget: "woofx3:widget:timer",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      visible: true,
      z: "a0000",
      settings: { image: external() },
      name: "",
      rotation: 0,
      opacity: 1,
      locked: false,
      extra: {},
    };
    await docs.submit("s1", "published", 0, [{ p: ["widgets", "added"], oi: placement }]);
    expect(pushed().ops).toEqual([
      { p: ["widgets", "added"], oi: { ...placement, settings: { image: { ...external(), url: EXTERNAL_PROXIED } } } },
    ]);
    expect(pushed().meta.added as PlacementMeta).toMatchObject({ mediaProxyBase: BASE });
  });

  it("collects the external media URLs editors put in either version", async () => {
    const { docs } = documents([
      instance("themed", { image: external() }, true),
      instance("plain", { logo: library }, false),
    ]);
    expect([...(await docs.editedMediaUrls("s1"))]).toEqual([EXTERNAL]);
  });
});

describe("FrameCatalog — media proxy base", () => {
  const frame = (theme: FrameTheme | null) =>
    new FrameCatalog(
      { fetchWidgetFrame: async () => ({ entryHtml: "<html></html>", resourceBaseUrl: RESOURCE_BASE, theme }) },
      logger()
    ).frame([instance("a", {}, false)]);

  it("sets it for a widget with a theme contract, and not for one without", async () => {
    expect((await frame(THEME))[0]!.mediaProxyBase).toBe(BASE);
    expect((await frame(null))[0]!.mediaProxyBase).toBeUndefined();
  });
});

describe("FrameAssembler — alert widgets", () => {
  async function bootSettings(theme: FrameTheme | null): Promise<unknown> {
    const delivery = {
      alertId: "alert-1",
      layout: {
        width: 100,
        height: 100,
        widgets: [
          {
            id: "t1",
            widgetCanonicalId: "woofx3:widget:timer",
            moduleId: "woofx3",
            manifestId: "timer",
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
          resourceBaseUrl: RESOURCE_BASE,
          theme,
        }),
      },
      mediaProxy: proxy,
    });
    const html = await (await assembler.assembleAlertWidget("s1", "evt-1", "t1", null)).text();
    const boot: WidgetBootPayload = JSON.parse(/window\.__WOOFX3_WIDGET_BOOT__ = (.*?);<\/script>/.exec(html)![1]!);
    return boot.settings;
  }

  it("proxies external media in a themeable alert widget's boot settings", async () => {
    expect(await bootSettings(THEME)).toEqual({ image: { ...external(), url: EXTERNAL_PROXIED }, logo: library });
  });

  it("leaves a widget without a theme contract loading external media directly", async () => {
    expect(await bootSettings(null)).toEqual({ image: external(), logo: library });
  });
});

describe("handleSceneDraftConfigRoute — media", () => {
  async function draftConfig(widgets: unknown[], edited: string[]) {
    const deps = {
      sessionTokens: { verify: async () => ({ sceneId: "s1" }) },
      host: {
        buildDraftConfig: async (_sceneId: string, placements: unknown[]) => ({
          scene: { id: "s1", name: "Main", layout: {}, widgets: placements },
        }),
      },
      sceneDocuments: { editedMediaUrls: async () => new Set(edited) },
      mediaProxy: proxy,
    } as unknown as HttpDeps;
    const resp = await handleSceneDraftConfigRoute(
      new Request("http://scene.test/scene/s1/draft-config", {
        method: "POST",
        headers: { Cookie: "sm_session_s1=good" },
        body: JSON.stringify({ widgets }),
      }),
      "s1",
      deps
    );
    return resp.json();
  }

  it("signs only URLs an editor put in the scene, for themeable placements, by placement", async () => {
    const typed = "https://elsewhere.example/anything.png";
    const body = await draftConfig(
      [
        { id: "themed", settings: { image: external(), other: external(typed) }, mediaProxyBase: BASE },
        { id: "plain", settings: { image: external() } },
      ],
      [EXTERNAL]
    );
    expect(body.scene.widgets[0].settings.image.url).toBe(EXTERNAL_PROXIED);
    expect(body.scene.widgets[0].settings.other.url).toBe(typed);
    expect(body.scene.widgets[1].settings.image.url).toBe(EXTERNAL);
    expect(body.mediaUrls).toEqual({ themed: { [EXTERNAL]: EXTERNAL_PROXIED } });
  });

  it("signs nothing a page sends that is not in the scene", async () => {
    const body = await draftConfig([{ id: "themed", settings: { image: external() }, mediaProxyBase: BASE }], []);
    expect(body.scene.widgets[0].settings.image.url).toBe(EXTERNAL);
    expect(body.mediaUrls).toEqual({ themed: {} });
  });
});

describe("handleMediaProxyRoute", () => {
  const path = new URL(EXTERNAL_PROXIED).pathname;

  it("matches only a single token segment under the media path", () => {
    expect(isMediaProxyPath(path)).toBe(true);
    expect(isMediaProxyPath("/assets/media/")).toBe(false);
    expect(isMediaProxyPath("/assets/media/a/b")).toBe(false);
  });

  it("grants no cross-origin reads", () => {
    expect(corsHeadersFor(path)).toEqual({});
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
          "Access-Control-Allow-Origin": "*",
        },
      });
    });
    const url = new URL(`http://scene.test${path}`);
    const req = new Request(url, { headers: { Range: "bytes=10-19", Cookie: "sm_session_s1=x" } });
    const resp = await handleMediaProxyRoute(req, url, "http://barkloader.test/", logger(), fetchFn as never);
    expect(fetchFn.mock.calls[0]![0]).toBe(`http://barkloader.test${path}`);
    expect(resp.status).toBe(206);
    expect(resp.headers.get("Content-Range")).toBe("bytes 10-19/100");
    expect(resp.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(resp.headers.get("Set-Cookie")).toBeNull();
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(await resp.text()).toBe("0123456789");
  });

  it("refuses methods other than GET", async () => {
    const url = new URL(`http://scene.test${path}`);
    const resp = await handleMediaProxyRoute(new Request(url, { method: "POST" }), url, "http://b", logger());
    expect(resp.status).toBe(405);
  });
});
