import { describe, expect, it } from "bun:test";
import {
  MAX_TRANSITION_MS,
  applyWidgetTransition,
  isTransitionAvailable,
  isWidgetTransitionState,
  parsePlacementTransition,
  transitionEasing,
  widgetTransitionState,
} from "../src/widget-transitions";

describe("parsePlacementTransition", () => {
  it("accepts a generic transition", () => {
    expect(parsePlacementTransition({ type: "fade", durationMs: 400 })).toEqual({
      ok: true,
      transition: { type: "fade", durationMs: 400 },
    });
  });

  it("accepts a slide with a direction and an easing", () => {
    expect(
      parsePlacementTransition({ type: "slide", durationMs: 600, direction: "left", easing: "ease-in-out" })
    ).toEqual({ ok: true, transition: { type: "slide", durationMs: 600, direction: "left", easing: "ease-in-out" } });
  });

  it("accepts a type a widget may declare, leaving whether it does to the caller", () => {
    expect(parsePlacementTransition({ type: "typewriter", durationMs: 1200 }).ok).toBe(true);
  });

  it.each([
    [null, "must be an object"],
    [[], "must be an object"],
    [{ type: "Fade", durationMs: 400 }, "lowercase token"],
    [{ type: "fade" }, "durationMs"],
    [{ type: "fade", durationMs: 10 }, "durationMs"],
    [{ type: "fade", durationMs: MAX_TRANSITION_MS + 1 }, "durationMs"],
    [{ type: "fade", durationMs: 400.5 }, "durationMs"],
    [{ type: "fade", durationMs: 400, easing: "cubic-bezier(0,0,1,1)" }, "easing"],
    [{ type: "fade", durationMs: 400, direction: "up" }, "only a slide"],
    [{ type: "slide", durationMs: 400, direction: "sideways" }, "direction"],
    [{ type: "fade", durationMs: 400, delayMs: 100 }, "no field"],
  ])("refuses %j", (value, reason) => {
    const parsed = parsePlacementTransition(value);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? "" : parsed.reason).toContain(reason);
  });
});

describe("isTransitionAvailable", () => {
  it("allows every generic type and the widget's own", () => {
    expect(isTransitionAvailable("spin", [])).toBe(true);
    expect(isTransitionAvailable("typewriter", ["typewriter"])).toBe(true);
    expect(isTransitionAvailable("typewriter", [])).toBe(false);
  });
});

describe("transitionEasing", () => {
  it("eases out entering and in leaving unless one is given", () => {
    expect(transitionEasing({ type: "fade", durationMs: 100 }, "in")).toBe("ease-out");
    expect(transitionEasing({ type: "fade", durationMs: 100 }, "out")).toBe("ease-in");
    expect(transitionEasing({ type: "fade", durationMs: 100, easing: "linear" }, "out")).toBe("linear");
  });
});

describe("widgetTransitionState", () => {
  it("is what the shim accepts", () => {
    const state = widgetTransitionState({ type: "wave", durationMs: 900 }, "out");
    expect(state).toEqual({ phase: "out", type: "wave", durationMs: 900, easing: "ease-in" });
    expect(isWidgetTransitionState(state)).toBe(true);
    expect(isWidgetTransitionState({ ...state, easing: "bouncy" })).toBe(false);
    expect(isWidgetTransitionState({ ...state, type: "<script>" })).toBe(false);
  });
});

describe("applyWidgetTransition", () => {
  it("marks the root element, and clears the mark", () => {
    const doc = fakeDocument();
    applyWidgetTransition(doc, { phase: "in", type: "typewriter", durationMs: 1200, easing: "linear" });
    expect(doc.attributes.get("data-transition")).toBe("typewriter");
    expect(doc.attributes.get("data-transition-phase")).toBe("in");
    expect(doc.vars.get("--transition-duration")).toBe("1200ms");
    expect(doc.vars.get("--transition-easing")).toBe("linear");

    applyWidgetTransition(doc, null);
    expect(doc.attributes.size).toBe(0);
    expect(doc.vars.size).toBe(0);
  });
});

function fakeDocument() {
  const vars = new Map<string, string>();
  const attributes = new Map<string, string>();
  const documentElement = {
    style: {
      setProperty: (name: string, value: string) => void vars.set(name, value),
      removeProperty: (name: string) => {
        vars.delete(name);
        return "";
      },
    },
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute: (name: string) => void attributes.delete(name),
    textContent: null as string | null,
  };
  return { vars, attributes, documentElement, querySelectorAll: () => [] };
}
