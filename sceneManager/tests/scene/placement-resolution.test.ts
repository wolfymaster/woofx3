import { describe, expect, it, mock } from "bun:test";
import { OverlayHost } from "../../src/scene/scene-host";
import { OverlayTokenResolver } from "../../src/scene/token-resolver";

function fakeLogger() {
  return { debug: mock(() => {}), info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) } as any;
}

function hostWith(
  placements: unknown[],
  catalog: Array<{ moduleId: string; manifestId: string; acceptedEvents?: string[] }>
) {
  const logger = fakeLogger();
  const db = {
    getScene: mock(async () => ({
      status: { code: "OK" as const, message: "" },
      scene: {
        id: "scene-1",
        applicationId: "app-1",
        name: "Main",
        widgetsJson: JSON.stringify(placements),
        layoutJson: "{}",
      },
    })),
    listWidgets: mock(async () => ({
      status: { code: "OK" as const, message: "" },
      widgets: catalog.map((w) => ({ ...w, entry: "index.html" })),
    })),
  };
  const resolver = new OverlayTokenResolver(
    {
      resolveOverlayToken: async () => ({
        status: { code: "OK" as const, message: "" },
        sceneId: "scene-1",
        applicationId: "app-1",
      }),
    },
    logger
  );
  return { host: new OverlayHost(resolver, db as any, logger), logger };
}

const placement = (id: string, canonical: string) => ({
  id,
  widgetCanonicalId: canonical,
  position: {},
  settings: {},
});

describe("scene placement resolution", () => {
  it("gives each placement its widget definition's accepted events", async () => {
    const { host } = hostWith(
      [placement("inst-1", "woofx3:widget:media_alert"), placement("inst-2", "counter:widget:counter")],
      [
        { moduleId: "woofx3", manifestId: "media_alert", acceptedEvents: ["channel.follow", "channel.cheer"] },
        { moduleId: "counter", manifestId: "counter", acceptedEvents: [] },
      ]
    );
    const state = await host.loadScene("ovl_token");
    expect(state?.instances.map((i) => i.acceptedEvents)).toEqual([["channel.follow", "channel.cheer"], []]);
  });

  it("gives a placement whose widget no longer exists no accepted events", async () => {
    const { host } = hostWith(
      [placement("inst-1", "builtin:widget:media_alert")],
      [{ moduleId: "woofx3", manifestId: "media_alert", acceptedEvents: ["channel.follow"] }]
    );
    const state = await host.loadScene("ovl_token");
    expect(state?.instances[0]?.acceptedEvents).toEqual([]);
  });

  it("marks a placement resolved when its widget is in the catalog", async () => {
    const { host } = hostWith(
      [placement("inst-1", "woofx3:widget:media_alert")],
      [{ moduleId: "woofx3", manifestId: "media_alert" }]
    );
    const state = await host.loadScene("ovl_token");
    expect(state?.instances[0]?.resolved).toBe(true);
  });

  // The failure this exists to surface: a widget renamed out from under a
  // scene. `builtin:widget:media_alert` became `woofx3:widget:media_alert`,
  // and every scene kept pointing at the old id.
  it("marks a placement unresolved when its widget no longer exists", async () => {
    const { host } = hostWith(
      [placement("inst-1", "builtin:widget:media_alert")],
      [{ moduleId: "woofx3", manifestId: "media_alert" }]
    );
    const state = await host.loadScene("ovl_token");
    expect(state?.instances[0]?.resolved).toBe(false);
  });

  it("names every dead placement once, with its scene", async () => {
    const { host, logger } = hostWith(
      [
        placement("inst-1", "builtin:widget:media_alert"),
        placement("inst-2", "woofx3:widget:media_alert"),
        placement("inst-3", "counter:widget:counter"),
      ],
      [{ moduleId: "woofx3", manifestId: "media_alert" }]
    );
    await host.loadScene("ovl_token");

    const call = logger.warn.mock.calls.find((c: unknown[]) => String(c[0]).includes("resolve to nothing"));
    expect(call).toBeDefined();
    const meta = call?.[1] as { sceneId: string; count: number; placements: Array<{ widgetCanonicalId: string }> };
    expect(meta.sceneId).toBe("scene-1");
    expect(meta.count).toBe(2);
    expect(meta.placements.map((p) => p.widgetCanonicalId).sort()).toEqual([
      "builtin:widget:media_alert",
      "counter:widget:counter",
    ]);
  });

  it("says nothing when every placement resolves", async () => {
    const { host, logger } = hostWith(
      [placement("inst-1", "woofx3:widget:media_alert")],
      [{ moduleId: "woofx3", manifestId: "media_alert" }]
    );
    await host.loadScene("ovl_token");
    const call = logger.warn.mock.calls.find((c: unknown[]) => String(c[0]).includes("resolve to nothing"));
    expect(call).toBeUndefined();
  });

  // A failed catalog lookup returns an empty list. Treating that as "every
  // widget is gone" would flag a whole scene broken on a transient db blip,
  // which is worse than the silence this replaces.
  it("does not mark placements dead when the catalog cannot be loaded", async () => {
    const { host, logger } = hostWith([placement("inst-1", "woofx3:widget:media_alert")], []);
    const state = await host.loadScene("ovl_token");
    expect(state?.instances[0]?.resolved).toBe(true);
    const call = logger.warn.mock.calls.find((c: unknown[]) => String(c[0]).includes("resolve to nothing"));
    expect(call).toBeUndefined();
  });

  it("handles a scene with no placements", async () => {
    const { host } = hostWith([], [{ moduleId: "woofx3", manifestId: "media_alert" }]);
    const state = await host.loadScene("ovl_token");
    expect(state?.instances).toEqual([]);
  });
});
