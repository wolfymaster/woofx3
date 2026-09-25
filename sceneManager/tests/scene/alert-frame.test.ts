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

describe("FrameAssembler.assemble — surfaces", () => {
  function sceneWith(hostsSurface: string): OverlayHost {
    const state: OverlaySceneState = {
      sceneId: "scene-1",
      name: "Scene",
      layout: {},
      instances: [
        {
          id: "inst-1",
          widgetCanonicalId: "woofx3:widget:text",
          moduleId: "woofx3",
          manifestId: "text",
          position: { x: 0, y: 0, width: 10, height: 10 },
          settings: {},
          hostsSurface,
          frameUrl: "",
          resolved: true,
        },
      ],
    };
    return { loadSceneById: async () => state } as unknown as OverlayHost;
  }

  it("frames a scene placement on the scene surface", async () => {
    const assembler = new FrameAssembler(sceneWith(""), fakeLogger(), { barkloader });
    const resp = await assembler.assemble("scene-1", "inst-1", null);
    expect(bootOf(await resp.text()).surface).toBe("scene");
  });

  it("never frames an alert widget, which the page draws itself", async () => {
    const assembler = new FrameAssembler(sceneWith("alert"), fakeLogger(), { barkloader });
    const resp = await assembler.assemble("scene-1", "inst-1", null);
    expect(await resp.text()).toBe(BLANK_FRAME_DOC);
  });
});
