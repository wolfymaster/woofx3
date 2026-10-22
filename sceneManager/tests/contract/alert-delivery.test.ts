import { describe, expect, it } from "bun:test";
import { parseAlertDelivery } from "../../contract/alert-delivery";

function placement(manifestId: string) {
  return {
    widget: `woofx3:widget:${manifestId}`,
    x: 10,
    y: 20,
    width: 300,
    height: 100,
    visible: true,
    z: "a0",
    settings: { text: "hi" },
    name: manifestId,
    rotation: 0,
    opacity: 1,
    locked: false,
    extra: {},
  };
}

const frame = { frameUrl: "/frames/woofx3/text?v=abc", linkedResources: { voice: "woofx3:voice:default" } };

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    alertId: "a1",
    layout: { layout: { width: 10, height: 10 }, widgets: { t1: placement("text") }, behaviors: {} },
    frames: { t1: frame },
    event: null,
    ...overrides,
  };
}

describe("parseAlertDelivery", () => {
  it("reads a delivery with a frame for each widget", () => {
    expect(parseAlertDelivery(delivery({ rowId: "row-1" }))).toEqual(delivery({ rowId: "row-1" }));
  });

  it("keeps a frame's media proxy base, and only the linked resources that are strings", () => {
    const parsed = parseAlertDelivery(
      delivery({
        frames: { t1: { ...frame, linkedResources: { voice: "woofx3:voice:default", bad: 7 }, mediaProxyBase: "/m/" } },
      })
    );
    expect(parsed?.frames.t1).toEqual({ ...frame, mediaProxyBase: "/m/" });
  });

  it("reads the triggering event, and null for anything that is not one", () => {
    expect(parseAlertDelivery(delivery({ event: { type: "channel.follow", data: { user: "sam" } } }))?.event).toEqual({
      type: "channel.follow",
      data: { user: "sam" },
    });
    expect(parseAlertDelivery(delivery({ event: { data: {} } }))?.event).toBeNull();
  });

  it("converts a list-shaped layout", () => {
    const parsed = parseAlertDelivery(
      delivery({
        layout: {
          width: 10,
          height: 10,
          widgets: [
            { id: "t1", widgetCanonicalId: "woofx3:widget:text", position: { x: 1, y: 2, width: 3, height: 4 } },
          ],
        },
      })
    );
    expect(parsed?.layout.widgets.t1).toMatchObject({ widget: "woofx3:widget:text", x: 1, y: 2, width: 3, height: 4 });
  });

  it("refuses a delivery it cannot play", () => {
    const cases: unknown[] = [
      "nope",
      null,
      { ...delivery(), alertId: undefined },
      delivery({ frames: undefined }),
      delivery({ frames: {} }),
      delivery({ frames: { t1: { frameUrl: "" } } }),
      delivery({ layout: { layout: { width: 0, height: 10 }, widgets: {}, behaviors: {} } }),
      delivery({ layout: { width: 10 } }),
    ];
    for (const raw of cases) {
      expect(parseAlertDelivery(raw)).toBeNull();
    }
  });
});
