import { describe, expect, it, mock } from "bun:test";
import type { CompositionDocument } from "@woofx3/scene/model";
import type { BarkloaderFrameClient, BarkloaderFrameInfo } from "../../src/scene/frame-assembler";
import { FrameCatalog, UNAVAILABLE_VERSION, frameDocumentUrl, frameVersion } from "../../src/scene/frame-catalog";
import type { OverlayWidgetInstance } from "../../src/scene/scene-host";

function logger() {
  return { debug() {}, info() {}, warn() {}, error() {} } as never;
}

function placement(overrides: Partial<OverlayWidgetInstance>): OverlayWidgetInstance {
  return {
    id: "inst-1",
    widgetCanonicalId: "mod:widget:w",
    moduleId: "mod",
    manifestId: "w",
    position: { x: 0, y: 0, width: 100, height: 100 },
    settings: {},
    resolved: true,
    visible: true,
    hostsSurface: "",
    frameUrl: "",
    ...overrides,
  };
}

const INFO: BarkloaderFrameInfo = {
  entryHtml: "<html></html>",
  resourceBaseUrl: "https://e/mod/abc/",
  theme: null,
  fontSettings: [],
};

describe("frameVersion", () => {
  it("changes exactly when the frame document would", () => {
    expect(frameVersion(INFO)).toBe(frameVersion({ ...INFO }));
    expect(frameVersion(INFO)).not.toBe(frameVersion({ ...INFO, resourceBaseUrl: "https://e/mod/def/" }));
    expect(frameVersion(INFO)).not.toBe(frameVersion({ ...INFO, entryHtml: "<html>v2</html>" }));
  });
});

describe("FrameCatalog", () => {
  it("gives each placement its widget's versioned document and its module's links", async () => {
    const barkloader: BarkloaderFrameClient = { fetchWidgetFrame: mock(async () => INFO) };
    const links = mock(async () => ({ timer: "mod:timer:a" }));
    const catalog = new FrameCatalog(barkloader, logger(), links);
    const [framed] = await catalog.frame([placement({ settings: { theme: "pack:theme:neon" } })]);
    expect(framed!.frameUrl).toBe(frameDocumentUrl("mod", "w", "pack:theme:neon", frameVersion(INFO)));
    expect(framed!.frameUrl).toBe(`/frames/mod/w?theme=pack%3Atheme%3Aneon&v=${frameVersion(INFO)}`);
    expect(framed!.linkedResources).toEqual({ timer: "mod:timer:a" });
  });

  it("asks once per widget and theme, and once per module, however many placements", async () => {
    const fetchWidgetFrame = mock(async () => INFO);
    const links = mock(async () => ({}));
    const catalog = new FrameCatalog({ fetchWidgetFrame }, logger(), links);
    await catalog.frame([
      placement({ id: "a" }),
      placement({ id: "b" }),
      placement({ id: "c", settings: { theme: "pack:theme:neon" } }),
    ]);
    expect(fetchWidgetFrame).toHaveBeenCalledTimes(2);
    expect(links).toHaveBeenCalledTimes(1);
  });

  it("never frames an alert area, which the page draws itself", async () => {
    const fetchWidgetFrame = mock(async () => INFO);
    const catalog = new FrameCatalog({ fetchWidgetFrame }, logger());
    const alert = placement({ hostsSurface: "alert", frameUrl: "" });
    expect(await catalog.frame([alert])).toEqual([alert]);
    expect(fetchWidgetFrame).not.toHaveBeenCalled();
  });

  it("still frames a placement when barkloader or its module's settings fail", async () => {
    const catalog = new FrameCatalog(
      {
        fetchWidgetFrame: async () => {
          throw new Error("barkloader down");
        },
      },
      logger(),
      async () => {
        throw new Error("db down");
      }
    );
    const [framed] = await catalog.frame([placement({})]);
    expect(framed!.frameUrl).toBe(frameDocumentUrl("mod", "w", undefined, UNAVAILABLE_VERSION));
    expect(framed!.linkedResources).toEqual({});
  });
});

describe("FrameCatalog.frameAlert", () => {
  function layoutOf(
    widgets: Record<string, { widget: string; settings: Record<string, unknown> }>
  ): CompositionDocument {
    return {
      layout: { width: 100, height: 100 },
      widgets: Object.fromEntries(
        Object.entries(widgets).map(([id, { widget, settings }]) => [
          id,
          {
            widget,
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            visible: true,
            z: "a0",
            settings,
            name: "",
            rotation: 0,
            opacity: 1,
            locked: false,
            extra: {},
          },
        ])
      ),
      behaviors: {},
    };
  }

  it("frames each layout widget at the document a placement of it loads, asking once per widget and theme", async () => {
    const fetchWidgetFrame = mock(async () => INFO);
    const links = mock(async () => ({ timer: "mod:timer:a" }));
    const catalog = new FrameCatalog({ fetchWidgetFrame }, logger(), links);

    const frames = await catalog.frameAlert(
      layoutOf({
        t1: { widget: "mod:widget:w", settings: {} },
        t2: { widget: "mod:widget:w", settings: {} },
        t3: { widget: "mod:widget:w", settings: { theme: "pack:theme:neon" } },
      })
    );

    expect(frames).toEqual({
      t1: {
        frameUrl: frameDocumentUrl("mod", "w", undefined, frameVersion(INFO)),
        linkedResources: { timer: "mod:timer:a" },
      },
      t2: {
        frameUrl: frameDocumentUrl("mod", "w", undefined, frameVersion(INFO)),
        linkedResources: { timer: "mod:timer:a" },
      },
      t3: {
        frameUrl: frameDocumentUrl("mod", "w", "pack:theme:neon", frameVersion(INFO)),
        linkedResources: { timer: "mod:timer:a" },
      },
    });
    expect(fetchWidgetFrame).toHaveBeenCalledTimes(2);
    expect(links).toHaveBeenCalledTimes(1);
  });

  it("frames a widget barkloader cannot answer for at an unversioned document", async () => {
    const catalog = new FrameCatalog({ fetchWidgetFrame: async () => null }, logger());
    const frames = await catalog.frameAlert(layoutOf({ t1: { widget: "mod:widget:w", settings: {} } }));
    expect(frames.t1!.frameUrl).toBe(frameDocumentUrl("mod", "w", undefined, UNAVAILABLE_VERSION));
  });

  it("refuses a widget whose canonical id does not parse", async () => {
    const catalog = new FrameCatalog({ fetchWidgetFrame: async () => INFO }, logger());
    await expect(catalog.frameAlert(layoutOf({ t1: { widget: "nonsense", settings: {} } }))).rejects.toThrow();
  });
});
