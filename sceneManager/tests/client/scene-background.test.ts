import { describe, expect, it } from "bun:test";
import { applySceneBackground, sceneBackground } from "../../public/scene-manager/scene-background";

function element(): HTMLElement {
  return { style: {} as CSSStyleDeclaration } as HTMLElement;
}

describe("sceneBackground", () => {
  it("reads the layout's background colour", () => {
    expect(sceneBackground({ backgroundColor: "#00ff00" })).toBe("#00ff00");
    expect(sceneBackground({ backgroundColor: "  transparent " })).toBe("transparent");
  });

  // A scene saved before the setting existed, or with it cleared, must stay
  // see-through rather than fall back to some opaque default.
  it("is null when the layout sets no colour", () => {
    expect(sceneBackground({})).toBeNull();
    expect(sceneBackground({ backgroundColor: "" })).toBeNull();
    expect(sceneBackground({ backgroundColor: 42 })).toBeNull();
  });
});

describe("applySceneBackground", () => {
  it("paints the colour onto the element", () => {
    const body = element();
    applySceneBackground(body, { backgroundColor: "#123456" });
    expect(body.style.backgroundColor).toBe("#123456");
  });

  it("clears a colour the scene no longer sets", () => {
    const body = element();
    applySceneBackground(body, { backgroundColor: "#123456" });
    applySceneBackground(body, {});
    expect(body.style.backgroundColor).toBe("");
  });
});
