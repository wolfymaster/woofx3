import { describe, expect, it, mock } from "bun:test";
import { FrameAssembler, type BarkloaderFrameClient } from "../../src/scene/frame-assembler";
import {
  draftFrameUrl,
  MAX_DRAFT_PARAM_LENGTH,
  OverlayHost,
  type OverlayWidgetInstance,
  parseDraftParam,
} from "../../src/scene/scene-host";
import { OverlayTokenResolver } from "../../src/scene/token-resolver";

function fakeLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;
}

function host(): OverlayHost {
  const db = {
    getScene: mock(async () => ({
      status: { code: "OK" as const, message: "" },
      scene: {
        id: "scene-1",
        name: "Main",
        widgetsJson: JSON.stringify([
          { id: "text-1", widgetCanonicalId: "woofx3:widget:text", position: {}, settings: { text: "saved" } },
        ]),
        layoutJson: JSON.stringify({ backgroundColor: "#000" }),
      },
    })),
    listWidgets: mock(async () => ({
      status: { code: "OK" as const, message: "" },
      widgets: [
        { moduleId: "woofx3", manifestId: "text", entry: "", surfaces: ["scene"], hostsSurface: "" },
        { moduleId: "woofx3", manifestId: "alerts", entry: "", surfaces: ["scene"], hostsSurface: "alert" },
      ],
    })),
  };
  const resolver = new OverlayTokenResolver(
    { resolveOverlayToken: async () => ({ status: { code: "OK" } }) } as any,
    fakeLogger()
  );
  return new OverlayHost(resolver, db as any, fakeLogger());
}

function instance(settings: Record<string, unknown>): OverlayWidgetInstance {
  return {
    id: "text-1",
    widgetCanonicalId: "woofx3:widget:text",
    moduleId: "woofx3",
    manifestId: "text",
    position: { x: 0, y: 0, width: 100, height: 50 },
    settings,
    hostsSurface: "",
    frameUrl: "/scene/scene-1/widget/text-1",
    resolved: true,
  };
}

describe("draftFrameUrl", () => {
  it("carries the placement's frame-deciding fields, readable back by parseDraftParam", () => {
    const url = draftFrameUrl("scene-1", instance({ text: "Hello {value}" }));
    expect(url).toStartWith("/scene/scene-1/draft-widget/text-1?draft=");
    const draft = new URL(url!, "http://scene.test").searchParams.get("draft");
    expect(parseDraftParam(draft)).toEqual({
      id: "text-1",
      widgetCanonicalId: "woofx3:widget:text",
      settings: { text: "Hello {value}" },
    });
  });

  it("is null for a placement too long to carry in a URL", () => {
    expect(draftFrameUrl("scene-1", instance({ text: "x".repeat(MAX_DRAFT_PARAM_LENGTH) }))).toBeNull();
  });
});

describe("parseDraftParam", () => {
  it("is null for a missing, oversized or malformed draft", () => {
    expect(parseDraftParam(null)).toBeNull();
    expect(parseDraftParam("x".repeat(MAX_DRAFT_PARAM_LENGTH + 1))).toBeNull();
    expect(parseDraftParam("not-json")).toBeNull();
  });
});

describe("OverlayHost.buildDraftConfig", () => {
  it("serves the saved layout with the draft's placements, each framed by its draft", async () => {
    const config = (await host().buildDraftConfig("scene-1", [
      { id: "text-1", widgetCanonicalId: "woofx3:widget:text", position: { x: 5, y: 6 }, settings: { text: "draft" } },
      { id: "alerts-1", widgetCanonicalId: "woofx3:widget:alerts", position: {}, settings: {} },
      { id: "", widgetCanonicalId: "woofx3:widget:text" },
    ])) as { scene: { layout: unknown; widgets: Record<string, unknown>[] } };

    expect(config.scene.layout).toEqual({ backgroundColor: "#000" });
    expect(config.scene.widgets.map((w) => w.id)).toEqual(["text-1", "alerts-1"]);
    const [text, alerts] = config.scene.widgets;
    expect(text?.settings).toEqual({ text: "draft" });
    expect(text?.frameUrl).toStartWith("/scene/scene-1/draft-widget/text-1?draft=");
    // The catalog, not the draft, decides that a placement is an alert area.
    expect(alerts?.hostsSurface).toBe("alert");
  });
});

describe("FrameAssembler.assembleDraft", () => {
  function assembler() {
    const barkloader: BarkloaderFrameClient = {
      fetchWidgetFrame: mock(async () => ({
        entryHtml: "<!doctype html><head></head><body></body>",
        resourceBaseUrl: "https://cdn.example.com/w/",
        theme: null,
      })),
    };
    return new FrameAssembler(host(), fakeLogger(), { barkloader });
  }
  const BLANK = "<!doctype html><html><head></head><body></body></html>";

  it("renders the settings the draft carries, not the saved ones", async () => {
    const resp = await assembler().assembleDraft(
      "scene-1",
      "text-1",
      { id: "text-1", widgetCanonicalId: "woofx3:widget:text", settings: { text: "draft" } },
      "nonce1"
    );
    const html = await resp.text();
    expect(html).toContain('"settings":{"text":"draft"}');
    expect(html).toContain('"nonce":"nonce1"');
  });

  it("refuses a draft for another placement, an alert area, or none at all", async () => {
    const a = assembler();
    const other = await a.assembleDraft(
      "scene-1",
      "text-2",
      { id: "text-1", widgetCanonicalId: "woofx3:widget:text" },
      null
    );
    expect(await other.text()).toBe(BLANK);
    const alert = await a.assembleDraft(
      "scene-1",
      "alerts-1",
      { id: "alerts-1", widgetCanonicalId: "woofx3:widget:alerts" },
      null
    );
    expect(await alert.text()).toBe(BLANK);
    expect(await (await a.assembleDraft("scene-1", "text-1", null, null)).text()).toBe(BLANK);
  });
});
