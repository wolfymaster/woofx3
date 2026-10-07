import { describe, expect, it } from "bun:test";
import { collectMediaKeys, MAX_MEDIA_KEYS, mediaKeyOf } from "../../src/scene/media-keys";
import { sceneMediaKeys } from "../../src/scene/media-manifest";
import type { OverlayWidgetInstance } from "../../src/scene/scene-host";

const SOUND_URL = "https://scene.example.test/assets/user/r1/air%20horn.mp3";

function placement(id: string, settings: Record<string, unknown>, hostsSurface = ""): OverlayWidgetInstance {
  return {
    id,
    widgetCanonicalId: "woofx3:widget:audio",
    moduleId: "woofx3",
    manifestId: "audio",
    position: { x: 0, y: 0, width: 10, height: 10 },
    settings,
    hostsSurface,
    frameUrl: "",
    resolved: true,
  };
}

function alertStep(parameters: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { id: "a", type: "action", action: "alert", parameters, ...extra };
}

function layoutWith(settings: Record<string, unknown>) {
  return { width: 100, height: 100, widgets: [{ id: "w", widgetCanonicalId: "woofx3:widget:audio", settings }] };
}

describe("mediaKeyOf", () => {
  it("reads the repository key of an engine asset URL, decoded", () => {
    expect(mediaKeyOf(SOUND_URL)).toBe("user/r1/air horn.mp3");
  });

  it("reads the key of a module workflow's unresolved asset token", () => {
    expect(mediaKeyOf("${woofx3_asset_url:modules/wm/abc/assets/confetti.gif}")).toBe(
      "modules/wm/abc/assets/confetti.gif"
    );
  });

  it("is not media for a widget bundle or theme file, which its frame loads itself", () => {
    expect(mediaKeyOf("https://scene.example.test/assets/modules/wm/abc/widgets/w/index.html")).toBeNull();
    expect(mediaKeyOf("https://scene.example.test/assets/modules/wm/abc/themes/t/theme.css")).toBeNull();
  });

  it("is not media for another host's path, a relative path or a traversal", () => {
    expect(mediaKeyOf("https://cdn.example.test/sound.mp3")).toBeNull();
    expect(mediaKeyOf("/assets/user/r1/sound.mp3")).toBeNull();
    expect(mediaKeyOf("https://scene.example.test/assets/user/r1%2F..%2Fx")).toBeNull();
    expect(mediaKeyOf("https://scene.example.test/assets/widget-host-shim.js")).toBeNull();
  });
});

describe("collectMediaKeys", () => {
  it("finds media in the asset picker's value and in plain strings, at any depth", () => {
    const keys = new Set<string>();
    collectMediaKeys({ src: { id: "r1", url: SOUND_URL }, nested: [["${woofx3_asset_url:user/r2/a.png}"]] }, keys);
    expect([...keys]).toEqual(["user/r1/air horn.mp3", "user/r2/a.png"]);
  });

  it("stops at the key limit", () => {
    const keys = new Set<string>();
    const urls = Array.from({ length: MAX_MEDIA_KEYS + 5 }, (_, i) => `https://s.test/assets/user/r${i}/f.mp3`);
    collectMediaKeys(urls, keys);
    expect(keys.size).toBe(MAX_MEDIA_KEYS);
  });
});

describe("sceneMediaKeys", () => {
  const alerts = placement("alerts", { name: "main" }, "alert");

  it("collects the media of the scene's own placements", () => {
    expect(sceneMediaKeys([placement("bg", { src: { url: SOUND_URL } })], [])).toEqual(["user/r1/air horn.mp3"]);
  });

  it("collects the layout media of alert steps that target one of the scene's alert widgets", () => {
    const steps = JSON.stringify([
      alertStep({ target: "main", layout: layoutWith({ src: { url: SOUND_URL } }) }),
      alertStep({ target: "other", layout: layoutWith({ src: "https://s.test/assets/user/r9/x.mp3" }) }),
    ]);
    expect(sceneMediaKeys([alerts], [steps])).toEqual(["user/r1/air horn.mp3"]);
  });

  it("counts a step with no target as targeting the default alert widget", () => {
    const steps = JSON.stringify([alertStep({ layout: layoutWith({ src: SOUND_URL }) })]);
    expect(sceneMediaKeys([placement("alerts", {}, "alert")], [steps])).toEqual(["user/r1/air horn.mp3"]);
    expect(sceneMediaKeys([alerts], [steps])).toEqual([]);
  });

  it("counts a target expression as targeting every alert widget", () => {
    const steps = JSON.stringify([
      alertStep({ target: "${trigger.data.widget}", layout: layoutWith({ src: SOUND_URL }) }),
    ]);
    expect(sceneMediaKeys([alerts], [steps])).toEqual(["user/r1/air horn.mp3"]);
  });

  it("skips disabled steps, other actions, and steps that do not parse", () => {
    const steps = [
      JSON.stringify([alertStep({ target: "main", layout: layoutWith({ src: SOUND_URL }) }, { disabled: true })]),
      JSON.stringify([{ id: "b", type: "action", action: "log", parameters: { src: SOUND_URL } }]),
      "{not json",
    ];
    expect(sceneMediaKeys([alerts], steps)).toEqual([]);
  });

  it("reads no workflow media for a scene without an alert widget", () => {
    const steps = JSON.stringify([alertStep({ layout: layoutWith({ src: SOUND_URL }) })]);
    expect(sceneMediaKeys([placement("bg", {})], [steps])).toEqual([]);
  });
});
