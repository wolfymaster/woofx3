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

  it("keeps the stored editor state out of every loaded version", async () => {
    const host = hostWith({ widgetsJson: placements("published"), layoutJson: "{}", editorStateJson: '{"v":4}' });
    expect(Object.keys((await host.loadSceneById("scene-1"))!)).not.toContain("editorStateJson");
    expect(Object.keys((await host.loadSceneById("scene-1", "draft"))!)).not.toContain("editorStateJson");
  });

  it("loads both versions and the editor state from one read for the scene documents", async () => {
    const editorStateJson = '{ "v": 4, "headId": "e.4", "clients": {} }';
    const host = hostWith({
      widgetsJson: placements("published"),
      layoutJson: "{}",
      hasDraft: true,
      draftWidgetsJson: placements("draft"),
      draftLayoutJson: "{}",
      editorStateJson,
    });
    const editable = await host.loadEditableScene("scene-1");
    expect(editable!.published.instances.map((i) => i.id)).toEqual(["published"]);
    expect(editable!.draft.instances.map((i) => i.id)).toEqual(["draft"]);
    expect(editable!.editorStateJson).toBe(editorStateJson);
  });

  it("loads no editor state when none is stored", async () => {
    const host = hostWith({ widgetsJson: placements("published"), layoutJson: "{}", editorStateJson: "" });
    expect((await host.loadEditableScene("scene-1"))!.editorStateJson).toBeNull();
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

describe("OverlayHost — composition kinds", () => {
  function hostWith(sceneFields: Record<string, unknown>) {
    const db = {
      getScene: mock(async () => ({
        status: { code: "OK" as const, message: "" },
        scene: { id: "scene-1", name: "Main", widgetsJson: "[]", layoutJson: "{}", ...sceneFields },
      })),
      listWidgets: mock(async () => ({ status: { code: "OK" as const, message: "" }, widgets: [] })),
    };
    const resolver = new OverlayTokenResolver(
      { resolveOverlayToken: async () => ({ status: { code: "OK" as const, message: "" }, sceneId: "scene-1" }) },
      fakeLogger()
    );
    return new OverlayHost(resolver, db as any, fakeLogger());
  }
  const fade = { type: "transition", kind: "fade", target: "a", order: "a0", timing: {}, params: {} };
  const field = { id: "name", label: "Name", type: "text" };

  it("serves no overlay page for an alert, even through a token that resolves to one", async () => {
    const host = hostWith({ kind: "alert" });
    expect(await host.loadScene("ovl_token")).toBeNull();
    expect(await host.buildConfig("ovl_token")).toEqual({ scene: null });
    expect((await host.loadSceneById("scene-1"))!.kind).toBe("alert");
  });

  it("reads a row without a kind as a scene, and skips one of a kind it does not know", async () => {
    expect((await hostWith({}).loadScene("ovl_token"))!.kind).toBe("scene");
    expect(await hostWith({ kind: "widget" }).loadSceneById("scene-1")).toBeNull();
  });

  it("loads each version's behaviors and the inputs into both", async () => {
    const host = hostWith({
      kind: "alert",
      behaviorsJson: JSON.stringify({ b1: fade }),
      inputsJson: JSON.stringify([field]),
      hasDraft: true,
      draftWidgetsJson: "[]",
      draftLayoutJson: "{}",
      draftBehaviorsJson: JSON.stringify({ b2: fade }),
    });
    const editable = await host.loadEditableScene("scene-1");
    expect(Object.keys(editable!.published.behaviors)).toEqual(["b1"]);
    expect(Object.keys(editable!.draft.behaviors)).toEqual(["b2"]);
    expect(editable!.published.inputs).toEqual([field]);
    expect(editable!.draft.inputs).toEqual([field]);
  });

  it("loads none for behaviors or inputs that are not the stored shape", async () => {
    const host = hostWith({ behaviorsJson: "[]", inputsJson: "{}" });
    const state = await host.loadSceneById("scene-1");
    expect(state!.behaviors).toEqual({});
    expect(state!.inputs).toEqual([]);
  });
});
