import { describe, expect, it } from "bun:test";
import {
  contractDefaultTheme,
  normalizeModulePath,
  type PreviewWidget,
  parsePreviewModule,
  widgetFilePath,
  widgetRelativePath,
} from "../preview/module";

function widgetOf(raw: unknown): PreviewWidget {
  const read = parsePreviewModule({ id: "mod", widgets: [raw] });
  if (!read.ok) {
    throw new Error(read.error);
  }
  const [widget] = read.module.widgets;
  if (widget === undefined) {
    throw new Error("no widget");
  }
  return widget;
}

describe("normalizeModulePath", () => {
  it.each([
    ["widgets/a/index.html", "widgets/a/index.html"],
    ["./widgets/a/", "widgets/a/"],
    ["/widgets/a", "widgets/a"],
    ["  widgets\\a\\index.html ", "widgets/a/index.html"],
    ["widgets/../secret", null],
    ["..", null],
  ])("%p is %p", (path, expected) => {
    expect(normalizeModulePath(path)).toBe(expected);
  });
});

describe("widgetRelativePath", () => {
  it.each([
    ["widgets/a/index.html", "index.html"],
    ["./widgets/a/img/bg.png", "img/bg.png"],
    ["widgets/a/", null],
    ["widgets/ab/index.html", null],
    ["widgets/a/../b/index.html", null],
    ["other/index.html", null],
  ])("%p is %p inside widgets/a", (path, expected) => {
    expect(widgetRelativePath("widgets/a", path)).toBe(expected);
  });
});

describe("parsePreviewModule", () => {
  it("reads each widget's files, settings, surfaces and font settings", () => {
    const read = parsePreviewModule({
      id: "mod",
      name: "My Module",
      widgets: [
        {
          id: "counter",
          name: "Counter",
          entry: "widgets/counter/index.html",
          assets: "./widgets/counter/",
          surfaces: ["scene", "alert", "elsewhere"],
          settingsSchema: [
            { id: "label", label: "Label", type: "text" },
            { id: "font", label: "Font", type: "font" },
            { id: "broken", type: "text" },
            { id: "title", label: "Title font", type: "font" },
          ],
        },
      ],
    });
    expect(read).toEqual({
      ok: true,
      module: {
        id: "mod",
        name: "My Module",
        widgets: [
          {
            id: "counter",
            name: "Counter",
            canonicalId: "mod:widget:counter",
            assetsDir: "widgets/counter",
            entry: "index.html",
            settingsSchema: [
              { id: "label", label: "Label", type: "text" },
              { id: "font", label: "Font", type: "font" },
              { id: "title", label: "Title font", type: "font" },
            ],
            surfaces: ["scene", "alert"],
            theme: null,
            fontSettings: ["font", "title"],
          },
        ],
      },
    });
  });

  it("defaults the name to the id, and the surfaces to a scene", () => {
    const read = parsePreviewModule({ id: "mod", widgets: [{ id: "w", entry: "w/index.html", assets: "w" }] });
    expect(read.ok && read.module.name).toBe("mod");
    expect(read.ok && read.module.widgets[0]?.surfaces).toEqual(["scene"]);
  });

  it("leaves out a widget with no entry, which the scene manager draws itself", () => {
    const read = parsePreviewModule({
      id: "mod",
      widgets: [{ id: "alert", name: "Alert area", hostsSurface: "alert" }],
    });
    expect(read).toEqual({ ok: true, module: { id: "mod", name: "mod", widgets: [] } });
  });

  it.each([
    [null, "the manifest must be a JSON object"],
    [{ name: "x" }, "the manifest's `id`"],
    [{ id: "bad id" }, "the manifest's `id`"],
    [{ id: "mod", widgets: {} }, "`widgets` must be an array"],
    [{ id: "mod", widgets: [{ name: "x" }] }, "widgets[0] needs an `id`"],
    [{ id: "mod", widgets: [{ id: "w", entry: "w/index.html" }] }, "widget w: `entry` needs an `assets` directory"],
    [{ id: "mod", widgets: [{ id: "w", entry: "x/index.html", assets: "w" }] }, "must be inside w/"],
    [{ id: "mod", widgets: [{ id: "w", entry: "w/", assets: "w" }] }, "must be inside w/"],
    [{ id: "mod", widgets: [{ id: "w", entry: "index.html", assets: "../w" }] }, "`assets` must be a directory"],
    [
      { id: "mod", widgets: [{ id: "w", entry: "w/i.html", assets: "w", theme: { contractVersion: 0 } }] },
      "widget w: `theme.contractVersion`",
    ],
    [
      {
        id: "mod",
        widgets: [
          {
            id: "w",
            entry: "w/i.html",
            assets: "w",
            theme: { contractVersion: 1, variables: [{ id: "a", type: "size" }] },
          },
        ],
      },
      "`theme.variables`",
    ],
  ])("refuses %j", (raw, error) => {
    const read = parsePreviewModule(raw);
    expect(read.ok).toBe(false);
    expect(read.ok ? "" : read.error).toContain(error);
  });
});

describe("contractDefaultTheme", () => {
  const base = "http://127.0.0.1:4400/assets/modules/mod/preview/widgets/w/";

  it("is null for a widget without a contract", () => {
    expect(contractDefaultTheme(widgetOf({ id: "w", entry: "w/i.html", assets: "w" }), base)).toBeNull();
  });

  it("resolves every default as barkloader does when no theme is selected", () => {
    const widget = widgetOf({
      id: "w",
      entry: "widgets/w/index.html",
      assets: "widgets/w",
      theme: {
        contractVersion: 2,
        variables: [
          { id: "accent", type: "color", default: " #7ad7ff " },
          { id: "scale", type: "number", default: 1.5 },
          { id: "font", type: "text", default: "Inter" },
          { id: "empty", type: "text", default: "  " },
          { id: "wrong", type: "number", default: "12" },
        ],
        assetSlots: [
          { id: "background", default: "./widgets/w/bg.png" },
          { id: "outside", default: "elsewhere/bg.png" },
          { id: "sound" },
        ],
      },
    });
    expect(contractDefaultTheme(widget, base)).toEqual({
      id: null,
      contractVersion: 2,
      variables: { accent: "#7ad7ff", scale: "1.5", font: "Inter" },
      assets: { background: `${base}bg.png`, outside: null, sound: null },
      defaultAssets: { background: `${base}bg.png`, outside: null, sound: null },
      fallback: null,
      stylesheetUrl: null,
    });
  });
});

describe("widgetFilePath", () => {
  const widget = widgetOf({ id: "w", entry: "widgets/w/index.html", assets: "widgets/w" });

  it("finds a file inside the widget's assets directory", () => {
    expect(widgetFilePath("/m", widget, "img/a.png")).toBe("/m/widgets/w/img/a.png");
  });

  it("refuses a path that leaves it", () => {
    expect(widgetFilePath("/m", widget, "../../manifest.json")).toBeNull();
    expect(widgetFilePath("/m", widget, "")).toBeNull();
  });
});
