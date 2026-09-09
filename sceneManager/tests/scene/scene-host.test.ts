import { describe, expect, it, mock } from "bun:test";
import { EventType } from "@woofx3/common/cloudevents/Twitch";
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
  it("derives an absolute frameUrl under /scene/{sceneId}/widget/ (never relative — the shell has no trailing slash)", async () => {
    const db = {
      getScene: mock(async () => ({
        status: { code: "OK" as const, message: "" },
        scene: {
          id: "scene-1",
          applicationId: "app-1",
          name: "Main",
          widgetsJson: JSON.stringify([
            {
              id: "inst-1",
              widgetCanonicalId: "woofx3:widget:media_alert",
              position: {},
              settings: {},
              acceptedEvents: [EventType.Follow],
            },
          ]),
          layoutJson: "{}",
        },
      })),
      listWidgets: mock(async () => ({ status: { code: "OK" as const, message: "" }, widgets: [] })),
    };
    const resolver = new OverlayTokenResolver(
      { resolveOverlayToken: async () => ({ status: { code: "OK" as const, message: "" }, sceneId: "scene-1", applicationId: "app-1" }) },
      fakeLogger()
    );
    const host = new OverlayHost(resolver, db as any, fakeLogger());
    const state = await host.loadScene("ovl_token");
    expect(state?.instances[0]?.frameUrl).toBe("/scene/scene-1/widget/inst-1");
    expect(state?.instances[0]?.acceptedEvents).toContain(EventType.Follow);
  });

  // media_alert used to be the one widget whose acceptedEvents could come
  // from a hardcoded spec when the placement carried none. It is an ordinary
  // module widget now, so a placement that stores none accepts none -- there
  // is no widget sceneManager knows about out of band any more.
  it("takes acceptedEvents only from the placement, with no built-in fallback", async () => {
    const db = {
      getScene: mock(async () => ({
        status: { code: "OK" as const, message: "" },
        scene: {
          id: "scene-1",
          applicationId: "app-1",
          name: "Main",
          widgetsJson: JSON.stringify([
            { id: "inst-1", widgetCanonicalId: "woofx3:widget:media_alert", position: {}, settings: {} },
          ]),
          layoutJson: "{}",
        },
      })),
      listWidgets: mock(async () => ({ status: { code: "OK" as const, message: "" }, widgets: [] })),
    };
    const resolver = new OverlayTokenResolver(
      { resolveOverlayToken: async () => ({ status: { code: "OK" as const, message: "" }, sceneId: "scene-1", applicationId: "app-1" }) },
      fakeLogger()
    );
    const host = new OverlayHost(resolver, db as any, fakeLogger());
    const state = await host.loadScene("ovl_token");
    expect(state?.instances[0]?.acceptedEvents).toEqual([]);
  });
});
