import { describe, expect, it } from "bun:test";
import {
  type FontDocument,
  type FontLinkElement,
  createFontLoader,
  primaryFontFamily,
  requestableFontFamily,
} from "../src/widget-fonts";

interface FakeLink extends FontLinkElement {
  attributes: Map<string, string>;
  removed: boolean;
}

function fakeFontDocument(): FontDocument & { links: FakeLink[] } {
  const links: FakeLink[] = [];
  return {
    links,
    head: {
      appendChild(element) {
        links.push(element as FakeLink);
      },
    },
    createElement() {
      const link: FakeLink = {
        attributes: new Map(),
        removed: false,
        setAttribute(name, value) {
          link.attributes.set(name, value);
        },
        remove() {
          link.removed = true;
        },
      };
      return link;
    },
  };
}

const FONTS = { settings: ["fontFamily", "accentFont"], stylesheetUrl: "/fonts/css" };
const FRAME_URL = "http://127.0.0.1:9101/frames/woofx3/text?v=abc#boot=xyz";

function liveHrefs(doc: { links: FakeLink[] }): string[] {
  return doc.links.filter((l) => !l.removed).map((l) => l.attributes.get("href") ?? "");
}

describe("primaryFontFamily", () => {
  it("reads the first family of a list, unquoted", () => {
    expect(primaryFontFamily("Roboto, system-ui, sans-serif")).toBe("Roboto");
    expect(primaryFontFamily('"Libre Barcode 128", sans-serif')).toBe("Libre Barcode 128");
    expect(primaryFontFamily("'Open Sans'")).toBe("Open Sans");
    expect(primaryFontFamily("  ")).toBeNull();
  });
});

describe("requestableFontFamily", () => {
  it("skips generic families, odd names and non-strings", () => {
    expect(requestableFontFamily("system-ui, sans-serif")).toBeNull();
    expect(requestableFontFamily("Sans-Serif")).toBeNull();
    expect(requestableFontFamily("../etc/passwd")).toBeNull();
    expect(requestableFontFamily("Lobster&x=1")).toBeNull();
    expect(requestableFontFamily(42)).toBeNull();
    expect(requestableFontFamily('"Lobster", cursive')).toBe("Lobster");
  });
});

describe("createFontLoader", () => {
  it("links one stylesheet per family from the scene manager's origin", () => {
    const doc = fakeFontDocument();
    const loader = createFontLoader(doc, FONTS, FRAME_URL);
    loader.apply({ fontFamily: '"Open Sans", sans-serif', accentFont: "Open Sans", color: "Lobster" });
    expect(liveHrefs(doc)).toEqual(["http://127.0.0.1:9101/fonts/css?family=Open+Sans"]);
    expect(doc.links[0]!.attributes.get("rel")).toBe("stylesheet");
  });

  it("moves the link when a font setting changes and drops it when cleared", () => {
    const doc = fakeFontDocument();
    const loader = createFontLoader(doc, FONTS, FRAME_URL);
    loader.apply({ fontFamily: "Roboto, sans-serif" });
    loader.apply({ fontFamily: "Lobster, cursive" });
    expect(liveHrefs(doc)).toEqual(["http://127.0.0.1:9101/fonts/css?family=Lobster"]);
    loader.apply({ fontFamily: "system-ui" });
    expect(liveHrefs(doc)).toEqual([]);
  });

  it("does not relink a family that is already linked", () => {
    const doc = fakeFontDocument();
    const loader = createFontLoader(doc, FONTS, FRAME_URL);
    loader.apply({ fontFamily: "Roboto" });
    loader.apply({ fontFamily: "Roboto", color: "#fff" });
    expect(doc.links.length).toBe(1);
  });
});
