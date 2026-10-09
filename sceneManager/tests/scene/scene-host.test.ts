import { describe, expect, it, mock } from "bun:test";
import { OverlayHost, parseWidgetCanonicalId, stableModuleKeyFrom } from "../../src/scene/scene-host";
import { OverlayTokenResolver } from "../../src/scene/token-resolver";

describe("parseWidgetCanonicalId", () => {
  it("parses the simple 3-segment form", () => {
    expect(parseWidgetCanonicalId("woofx3:widget:media_alert")).toEqual({
      moduleKey: "woofx3",
      manifestId: "media_alert",
    });
  });

  it("parses a module key that contains colons (versioned form)", () => {
    expect(parseWidgetCanonicalId("spotify:1.0.0:df18e02:widget:now_playing")).toEqual({
      moduleKey: "spotify:1.0.0:df18e02",
      manifestId: "now_playing",
    });
  });

  it("uses the last :widget: marker when the module key contains the word 'widget'", () => {
    expect(parseWidgetCanonicalId("my:widget:module:widget:foo")).toEqual({
      moduleKey: "my:widget:module",
      manifestId: "foo",
    });
  });

  it("returns null when the marker is absent", () => {
    expect(parseWidgetCanonicalId("no-separator-here")).toBeNull();
  });

  it("returns null when the marker is at the start (empty moduleKey)", () => {
    expect(parseWidgetCanonicalId(":widget:foo")).toBeNull();
  });

  it("returns null when the manifestId is empty", () => {
    expect(parseWidgetCanonicalId("mod:widget:")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseWidgetCanonicalId("")).toBeNull();
  });
});

describe("stableModuleKeyFrom", () => {
  it("passes through a simple module key unchanged", () => {
    expect(stableModuleKeyFrom("woofx3")).toBe("woofx3");
    expect(stableModuleKeyFrom("spotify_sr")).toBe("spotify_sr");
  });

  it("strips version and hash segments from a versioned module key", () => {
    expect(stableModuleKeyFrom("spotify:1.0.0:df18e02")).toBe("spotify");
  });

  it("handles a key with only a single colon", () => {
    expect(stableModuleKeyFrom("mod:extra")).toBe("mod");
  });

  it("returns the first segment for any colon-delimited key", () => {
    expect(stableModuleKeyFrom("a:b:c:d")).toBe("a");
  });
});

function fakeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as any;
}

describe("OverlayHost — frameUrl", () => {
  it("derives an absolute frameUrl for the widget's document (never relative — the shell has no trailing slash)", async () => {
    const db = {
      getScene: mock(async () => ({
        status: { code: "OK" as const, message: "" },
        scene: {
          id: "scene-1",
          name: "Main",
          widgetsJson: JSON.stringify([
            { id: "inst-1", widgetCanonicalId: "woofx3:widget:media_alert", position: {}, settings: {} },
          ]),
          layoutJson: "{}",
        },
      })),
      listWidgets: mock(async () => ({
        status: { code: "OK" as const, message: "" },
        widgets: [{ moduleId: "woofx3", manifestId: "media_alert", entry: "" }],
      })),
    };
    const resolver = new OverlayTokenResolver(
      {
        resolveOverlayToken: async () => ({
          status: { code: "OK" as const, message: "" },
          sceneId: "scene-1",
        }),
      },
      fakeLogger()
    );
    const host = new OverlayHost(resolver, db as any, fakeLogger());
    const state = await host.loadScene("ovl_token");
    // Unversioned without a FrameCatalog; see frame-catalog.test.ts.
    expect(state?.instances[0]?.frameUrl).toBe("/frames/woofx3/media_alert?v=unavailable");
  });
});

describe("OverlayHost.loadSceneById — drafts", () => {
  function hostWith(sceneFields: Record<string, unknown>) {
    const db = {
      getScene: mock(async () => ({
        status: { code: "OK" as const, message: "" },
        scene: { id: "scene-1", name: "Main", ...sceneFields },
      })),
      listWidgets: mock(async () => ({ status: { code: "OK" as const, message: "" }, widgets: [] })),
    };
    const resolver = new OverlayTokenResolver({ resolveOverlayToken: async () => ({}) } as any, fakeLogger());
    return new OverlayHost(resolver, db as any, fakeLogger());
  }
  const placements = (id: string) => JSON.stringify([{ id, widgetCanonicalId: "woofx3:widget:text", settings: {} }]);

  it("loads the draft only when asked for it and the scene has one", async () => {
    const host = hostWith({
      widgetsJson: placements("published"),
      layoutJson: "{}",
      hasDraft: true,
      draftWidgetsJson: placements("draft"),
      draftLayoutJson: '{"backgroundColor":"#000"}',
    });
    expect((await host.loadSceneById("scene-1"))!.instances.map((i) => i.id)).toEqual(["published"]);
    const draft = await host.loadSceneById("scene-1", "draft");
    expect(draft!.instances.map((i) => i.id)).toEqual(["draft"]);
    expect(draft!.layout).toEqual({ backgroundColor: "#000" });
    expect(draft!.hasDraft).toBe(true);
  });

  it("reads a scene with no draft as its own draft", async () => {
    const host = hostWith({ widgetsJson: placements("published"), layoutJson: "{}", hasDraft: false });
    expect((await host.loadSceneById("scene-1", "draft"))!.instances.map((i) => i.id)).toEqual(["published"]);
  });

  it("keeps each placement as stored", async () => {
    const host = hostWith({ widgetsJson: placements("published"), layoutJson: "{}" });
    expect((await host.loadSceneById("scene-1"))!.instances[0]!.stored).toEqual({
      id: "published",
      widgetCanonicalId: "woofx3:widget:text",
      settings: {},
    });
  });
});

describe("OverlayHost — transitions", () => {
  function hostWith(placements: unknown[], logger = fakeLogger()) {
    const db = {
      getScene: mock(async () => ({
        status: { code: "OK" as const, message: "" },
        scene: { id: "scene-1", name: "Main", widgetsJson: JSON.stringify(placements), layoutJson: "{}" },
      })),
      listWidgets: mock(async () => ({
        status: { code: "OK" as const, message: "" },
        widgets: [
          {
            moduleId: "woofx3",
            manifestId: "text",
            entry: "",
            transitions: [{ id: "typewriter", label: "Typewriter" }],
          },
          { moduleId: "woofx3", manifestId: "image", entry: "" },
        ],
      })),
    };
    const resolver = new OverlayTokenResolver({ resolveOverlayToken: async () => ({}) } as any, fakeLogger());
    return new OverlayHost(resolver, db as any, logger);
  }
  const typewriter = { type: "typewriter", durationMs: 900 };
  const fade = { type: "fade", durationMs: 300 };

  it("reads a placement's transitions and what its widget declares", async () => {
    const host = hostWith([
      { id: "t", widgetCanonicalId: "woofx3:widget:text", transitionIn: typewriter, transitionOut: fade },
    ]);
    const [text] = (await host.loadSceneById("scene-1"))!.instances;
    expect(text).toMatchObject({ transitionIn: typewriter, transitionOut: fade, widgetTransitions: ["typewriter"] });
  });

  it("plays none for a stored transition that does not parse, and says so", async () => {
    const logger = fakeLogger();
    const host = hostWith(
      [{ id: "t", widgetCanonicalId: "woofx3:widget:text", transitionIn: { type: "fade", durationMs: -1 } }],
      logger
    );
    const [text] = (await host.loadSceneById("scene-1"))!.instances;
    expect(text!.transitionIn).toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("hands the page only the transitions each widget can play", async () => {
    const host = hostWith([
      { id: "t", widgetCanonicalId: "woofx3:widget:text", transitionIn: typewriter },
      { id: "i", widgetCanonicalId: "woofx3:widget:image", transitionIn: typewriter, transitionOut: fade },
    ]);
    const config = (await host.buildConfigById("scene-1")) as {
      scene: { widgets: Array<Record<string, unknown>> };
    };
    const [text, image] = config.scene.widgets;
    expect(text!.transitionIn).toEqual(typewriter);
    expect(image!.transitionIn).toBeUndefined();
    expect(image!.transitionOut).toEqual(fade);
  });
});
