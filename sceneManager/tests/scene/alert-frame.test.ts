import { describe, expect, it, mock } from "bun:test";
import type { WidgetBootPayload } from "@woofx3/module-sdk";
import { type BarkloaderFrameClient, BLANK_FRAME_DOC, FrameAssembler } from "../../src/scene/frame-assembler";
import type { OverlayHost, OverlaySceneState } from "../../src/scene/scene-host";

function fakeLogger() {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;
}

const barkloader: BarkloaderFrameClient = {
  fetchWidgetFrame: mock(async () => ({
    entryHtml: "<!doctype html><html><head></head><body></body></html>",
    resourceBaseUrl: "https://cdn.example.com/w/",
    theme: null,
    fontSettings: [],
  })),
};

function bootOf(html: string): WidgetBootPayload {
  const match = /window\.__WOOFX3_WIDGET_BOOT__ = (.*?);<\/script>/.exec(html);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]!);
}

const delivery = {
  alertId: "alert-1",
  layout: {
    width: 1920,
    height: 1080,
    widgets: [
      {
        id: "t1",
        widgetCanonicalId: "woofx3:widget:text",
        moduleId: "woofx3",
        manifestId: "text",
        position: { x: 0, y: 0, width: 10, height: 10 },
        settings: { text: "hi" },
      },
    ],
  },
  event: null,
};

function hostWithEvent(event: { type: string; value: unknown } | null): OverlayHost {
  return { loadSceneEvent: async () => event } as unknown as OverlayHost;
}

describe("FrameAssembler.assembleAlertWidget", () => {
  it("frames a layout widget with its settings, on the alert surface", async () => {
    const assembler = new FrameAssembler(hostWithEvent({ type: "alert", value: delivery }), fakeLogger(), {
      barkloader,
    });
    const resp = await assembler.assembleAlertWidget("scene-1", "evt-1", "t1", null);
    expect(bootOf(await resp.text())).toMatchObject({
      instanceId: "evt-1.t1",
      moduleId: "woofx3",
      widgetCanonicalId: "woofx3:widget:text",
      surface: "alert",
      settings: { text: "hi" },
    });
  });

  it("boots a widget entering with its own transition already playing it, and leaves a generic one to the page", async () => {
    const withTransition = (transitionIn: Record<string, unknown>) => ({
      ...delivery,
      layout: { ...delivery.layout, widgets: [{ ...delivery.layout.widgets[0]!, transitionIn }] },
    });
    const own = new FrameAssembler(
      hostWithEvent({ type: "alert", value: withTransition({ type: "typewriter", durationMs: 900 }) }),
      fakeLogger(),
      { barkloader }
    );
    const ownBoot = bootOf(await (await own.assembleAlertWidget("scene-1", "evt-1", "t1", null)).text());
    expect(ownBoot.transition).toEqual({ phase: "in", type: "typewriter", durationMs: 900, easing: "ease-out" });

    const generic = new FrameAssembler(
      hostWithEvent({ type: "alert", value: withTransition({ type: "fade", durationMs: 900 }) }),
      fakeLogger(),
      { barkloader }
    );
    const genericBoot = bootOf(await (await generic.assembleAlertWidget("scene-1", "evt-1", "t1", null)).text());
    expect(genericBoot.transition).toBeUndefined();
  });

  it("returns the uniform blank document for an unknown widget, a non-alert event, or another scene's event", async () => {
    const cases: Array<[{ type: string; value: unknown } | null, string]> = [
      [{ type: "alert", value: delivery }, "missing"],
      [{ type: "widget.event", value: delivery }, "t1"],
      [null, "t1"],
    ];
    for (const [event, widgetId] of cases) {
      const assembler = new FrameAssembler(hostWithEvent(event), fakeLogger(), { barkloader });
      const resp = await assembler.assembleAlertWidget("scene-1", "evt-1", widgetId, null);
      expect(await resp.text()).toBe(BLANK_FRAME_DOC);
    }
  });
});

describe("FrameAssembler.assembleDocument — surfaces", () => {
  const barkloader = {
    fetchWidgetFrame: async () => ({
      entryHtml: "<!doctype html><html><head></head></html>",
      resourceBaseUrl: "https://e/",
      theme: null,
      fontSettings: [],
    }),
  };

  it("frames a widget on the scene surface", async () => {
    const host = { loadSceneById: async () => null } as unknown as OverlayHost;
    const assembler = new FrameAssembler(host, fakeLogger(), { barkloader });
    const resp = await assembler.assembleDocument("mod", "w", null, null);
    expect(bootOf(await resp.text()).surface).toBe("scene");
  });
});
