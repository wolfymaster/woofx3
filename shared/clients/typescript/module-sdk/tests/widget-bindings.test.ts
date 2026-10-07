import { describe, expect, it } from "bun:test";
import { type BindingElement, applySettingBindings } from "../src/widget-bindings";

class FakeElement implements BindingElement {
  readonly attributes = new Map<string, string>();
  textContent: string | null;
  constructor(attributes: Record<string, string> = {}, text: string | null = null) {
    for (const [name, value] of Object.entries(attributes)) {
      this.attributes.set(name, value);
    }
    this.textContent = text;
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
}

function fakeDocument(elements: FakeElement[]) {
  const vars = new Map<string, string>();
  const root = Object.assign(new FakeElement(), {
    style: {
      setProperty: (name: string, value: string) => void vars.set(name, value),
      removeProperty: (name: string) => {
        vars.delete(name);
        return "";
      },
    },
  });
  return {
    vars,
    root,
    documentElement: root,
    // The root matches [data-setting-src] once a setting named src is mirrored.
    querySelectorAll: () => [root, ...elements],
  };
}

describe("applySettingBindings", () => {
  it("mirrors plain settings as custom properties on :root", () => {
    const doc = fakeDocument([]);
    applySettingBindings(doc, {
      color: "#ff0",
      fontSize: 48,
      showPanel: false,
      image: { url: 'https://cdn.test/a "b".png' },
      milestones: [1, 2],
    });
    expect(doc.vars.get("--setting-color")).toBe("#ff0");
    expect(doc.vars.get("--setting-fontSize")).toBe("48");
    expect(doc.vars.get("--setting-showPanel")).toBe("0");
    expect(doc.vars.get("--setting-image")).toBe('url("https://cdn.test/a \\22 b\\22 .png")');
    expect(doc.vars.has("--setting-milestones")).toBe(false);
  });

  it("mirrors booleans and short text as attributes on <html> for selectors", () => {
    const doc = fakeDocument([]);
    applySettingBindings(doc, { showPanel: false, align: "left", text: "x".repeat(100) });
    expect(doc.root.getAttribute("data-setting-showPanel")).toBe("false");
    expect(doc.root.getAttribute("data-setting-align")).toBe("left");
    expect(doc.root.getAttribute("data-setting-text")).toBeNull();
  });

  it("fills bound elements' text and URLs", () => {
    const headline = new FakeElement({ "data-setting": "headline" }, "default");
    const untouched = new FakeElement({ "data-setting": "missing" }, "kept");
    const image = new FakeElement({ "data-setting-src": "image" });
    const doc = fakeDocument([headline, untouched, image]);
    applySettingBindings(doc, { headline: "Thanks!", image: { url: "https://cdn.test/a.png" } });
    expect(headline.textContent).toBe("Thanks!");
    expect(untouched.textContent).toBe("kept");
    expect(image.getAttribute("src")).toBe("https://cdn.test/a.png");
  });

  it("applies only safe URLs", () => {
    const link = new FakeElement({ "data-setting-href": "link" });
    const relative = new FakeElement({ "data-setting-src": "local" });
    const doc = fakeDocument([link, relative]);
    applySettingBindings(doc, { link: "javascript:alert(1)", local: "assets/a.png" });
    expect(link.getAttribute("href")).toBeNull();
    expect(relative.getAttribute("src")).toBe("assets/a.png");
  });

  it("never binds <html> itself, though it carries data-setting-* mirrors", () => {
    const doc = fakeDocument([]);
    applySettingBindings(doc, { src: "https://cdn.test/a.png" });
    expect(doc.root.getAttribute("data-setting-src")).toBe("https://cdn.test/a.png");
    expect(doc.root.getAttribute("src")).toBeNull();
  });

  it("clears a setting that is gone", () => {
    const doc = fakeDocument([]);
    applySettingBindings(doc, { color: "#fff", align: "left" });
    applySettingBindings(doc, { color: "#000" }, { color: "#fff", align: "left" });
    expect(doc.vars.get("--setting-color")).toBe("#000");
    expect(doc.vars.has("--setting-align")).toBe(false);
    expect(doc.root.getAttribute("data-setting-align")).toBeNull();
  });

  it("skips ids that are not safe property names", () => {
    const doc = fakeDocument([]);
    applySettingBindings(doc, { "a;b": "x", "--x": "y" });
    expect(doc.vars.size).toBe(0);
  });
});
