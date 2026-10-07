import { describe, expect, it, mock } from "bun:test";
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
    hostsSurface: "",
    frameUrl: "",
    ...overrides,
  };
}

const INFO: BarkloaderFrameInfo = { entryHtml: "<html></html>", resourceBaseUrl: "https://e/mod/abc/", theme: null };

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
