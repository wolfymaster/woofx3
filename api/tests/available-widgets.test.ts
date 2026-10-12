import { describe, expect, test } from "bun:test";
import type { Woofx3EngineApi } from "@woofx3/api";
import type * as module_widget from "@woofx3/db/module_widget.pb";
import { scenesRoutes } from "../src/routes/scenes";

type AvailableWidgets = Awaited<ReturnType<Woofx3EngineApi["getAvailableWidgets"]>>;

function widget(overrides: Partial<module_widget.Widget>): module_widget.Widget {
  return {
    id: "uuid-w1",
    moduleId: "woofx3",
    manifestId: "text",
    name: "Text",
    description: "",
    directory: "widgets/text",
    alertTypes: [],
    settingsSchema: "[]",
    createdByType: "MODULE",
    createdByRef: "woofx3",
    entry: "",
    surfaces: ["scene", "alert"],
    hostsSurface: "",
    taxonomy: [],
    behaviorKinds: undefined,
    ...overrides,
  } as module_widget.Widget;
}

function available(widgets: module_widget.Widget[]): Promise<AvailableWidgets> {
  const host = {
    db: {
      async listWidgets() {
        return { widgets };
      },
    },
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  };
  const fn = (scenesRoutes as unknown as Record<string, () => Promise<AvailableWidgets>>).getAvailableWidgets;
  return fn.apply(host);
}

describe("getAvailableWidgets", () => {
  test("offers the kinds each widget declares for itself", async () => {
    const result = await available([
      widget({
        behaviorKinds: {
          transitions: [{ id: "typewriter", label: "Typewriter" }],
          effects: [{ id: "sparkle", label: "Sparkle" }],
        },
      }),
    ]);
    expect(result.widgets[0]?.behaviorKinds).toEqual({
      transitions: [{ id: "typewriter", label: "Typewriter" }],
      effects: [{ id: "sparkle", label: "Sparkle" }],
    });
  });

  test("a widget the catalog has no kinds for declares none", async () => {
    const result = await available([widget({ manifestId: "image" })]);
    expect(result.widgets[0]?.behaviorKinds).toEqual({ transitions: [], effects: [] });
  });
});
