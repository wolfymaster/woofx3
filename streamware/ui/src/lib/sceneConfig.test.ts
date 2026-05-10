import { describe, expect, it } from "bun:test";
import { parseSceneConfigFromUrl } from "./sceneConfig";

function searchFor(config: unknown): string {
  return "?config=" + encodeURIComponent(JSON.stringify(config));
}

describe("parseSceneConfigFromUrl", () => {
  it("returns empty scene when no config param", () => {
    expect(parseSceneConfigFromUrl("")).toEqual({ widgets: [] });
    expect(parseSceneConfigFromUrl("?other=foo")).toEqual({ widgets: [] });
  });

  it("returns empty scene for malformed JSON", () => {
    expect(parseSceneConfigFromUrl("?config=not-json")).toEqual({ widgets: [] });
  });

  it("returns empty scene when widgets is not an array", () => {
    expect(parseSceneConfigFromUrl(searchFor({ widgets: "nope" }))).toEqual({ widgets: [] });
  });

  it("parses a valid widget instance", () => {
    const search = searchFor({
      widgets: [
        {
          id: "a",
          widgetCanonicalId: "counter:widget:counter",
          moduleId: "counter",
          bundleUrl: "https://cdn.example.com/counter/index.html",
          position: { x: 100, y: 50, width: 300, height: 200 },
          settings: { label: "count", accentColor: "#fff" },
        },
      ],
    });
    const result = parseSceneConfigFromUrl(search);
    expect(result.widgets).toHaveLength(1);
    expect(result.widgets[0]).toEqual({
      id: "a",
      widgetCanonicalId: "counter:widget:counter",
      moduleId: "counter",
      bundleUrl: "https://cdn.example.com/counter/index.html",
      position: { x: 100, y: 50, width: 300, height: 200 },
      settings: { label: "count", accentColor: "#fff" },
    });
  });

  it("drops widgets with missing required fields", () => {
    const search = searchFor({
      widgets: [
        { id: "ok", widgetCanonicalId: "m:widget:w", moduleId: "m", bundleUrl: "u", position: { x: 0, y: 0, width: 1, height: 1 }, settings: {} },
        // missing bundleUrl
        { id: "bad1", widgetCanonicalId: "m:widget:w", moduleId: "m", position: { x: 0, y: 0, width: 1, height: 1 } },
        // missing position
        { id: "bad2", widgetCanonicalId: "m:widget:w", moduleId: "m", bundleUrl: "u" },
        // empty id
        { id: "", widgetCanonicalId: "m:widget:w", moduleId: "m", bundleUrl: "u", position: { x: 0, y: 0, width: 1, height: 1 } },
      ],
    });
    const result = parseSceneConfigFromUrl(search);
    expect(result.widgets.map((w) => w.id)).toEqual(["ok"]);
  });

  it("defaults missing settings to an empty object", () => {
    const search = searchFor({
      widgets: [
        {
          id: "a",
          widgetCanonicalId: "m:widget:w",
          moduleId: "m",
          bundleUrl: "u",
          position: { x: 0, y: 0, width: 1, height: 1 },
        },
      ],
    });
    const result = parseSceneConfigFromUrl(search);
    expect(result.widgets[0].settings).toEqual({});
  });

  it("parses acceptedEvents when present and drops non-string entries", () => {
    const search = searchFor({
      widgets: [
        {
          id: "w",
          widgetCanonicalId: "m:widget:w",
          moduleId: "m",
          bundleUrl: "u",
          position: { x: 0, y: 0, width: 1, height: 1 },
          acceptedEvents: [
            "twitch_platform:trigger:follow.user.twitch",
            42,
            "",
            "twitch_platform:trigger:cheer.user.twitch",
          ],
        },
      ],
    });
    const result = parseSceneConfigFromUrl(search);
    expect(result.widgets[0]?.acceptedEvents).toEqual([
      "twitch_platform:trigger:follow.user.twitch",
      "twitch_platform:trigger:cheer.user.twitch",
    ]);
  });

  it("omits acceptedEvents entirely when none are valid", () => {
    const search = searchFor({
      widgets: [
        {
          id: "w",
          widgetCanonicalId: "m:widget:w",
          moduleId: "m",
          bundleUrl: "u",
          position: { x: 0, y: 0, width: 1, height: 1 },
          acceptedEvents: [42, ""],
        },
      ],
    });
    const result = parseSceneConfigFromUrl(search);
    expect(result.widgets[0]?.acceptedEvents).toBeUndefined();
  });

  it("preserves a valid layout block", () => {
    const search = searchFor({
      widgets: [],
      layout: { width: 1920, height: 1080, theme: "dark" },
    });
    expect(parseSceneConfigFromUrl(search).layout).toEqual({
      width: 1920,
      height: 1080,
      theme: "dark",
    });
  });

  it("drops malformed layout (wrong types) without breaking the scene", () => {
    const search = searchFor({
      widgets: [],
      layout: { width: "not-a-number" },
    });
    const result = parseSceneConfigFromUrl(search);
    expect(result.widgets).toEqual([]);
    expect(result.layout).toBeUndefined();
  });

  it("returns empty scene on top-level non-object input", () => {
    expect(parseSceneConfigFromUrl("?config=42")).toEqual({ widgets: [] });
    expect(parseSceneConfigFromUrl("?config=null")).toEqual({ widgets: [] });
    expect(parseSceneConfigFromUrl("?config=" + encodeURIComponent("[]"))).toEqual({ widgets: [] });
  });
});
