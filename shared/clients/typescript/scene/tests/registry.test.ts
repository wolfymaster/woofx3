import { describe, expect, test } from "bun:test";
import {
  type BehaviorDocument,
  type CompositionDocument,
  createRegistry,
  DEFAULT_WIDGET_TRAITS,
  EFFECT_DEFAULTS,
  type EntityType,
  effectParamSpecs,
  HOST_EFFECT_KINDS,
  legacyTransitionId,
  MAX_TRANSITION_MS,
  normalizeComposition,
  type PlacementDocument,
  STRICT_REGISTRY,
  TOLERANT_REGISTRY,
  withoutWidget,
} from "../model";

function placement(overrides: Partial<PlacementDocument> = {}): PlacementDocument {
  return {
    widget: "woofx3:widget:text",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    visible: true,
    z: "a0",
    settings: {},
    name: "Text",
    rotation: 0,
    opacity: 1,
    locked: false,
    extra: {},
    ...overrides,
  };
}

function transition(overrides: Partial<BehaviorDocument> = {}): BehaviorDocument {
  return {
    type: "transition",
    kind: "fade",
    target: "w1",
    order: "a0",
    timing: { anchor: "enter", offsetMs: 0, durationMs: 400, easing: "ease-out" },
    params: { phase: "in" },
    ...overrides,
  };
}

describe("placements", () => {
  test("a placement with every field valid is accepted in both modes", () => {
    expect(STRICT_REGISTRY.invalidEntry("widgets", placement())).toBeNull();
    expect(TOLERANT_REGISTRY.invalidEntry("widgets", placement())).toBeNull();
  });

  test("a missing or invalid field is refused in both modes", () => {
    const { name: _name, ...nameless } = placement();
    for (const registry of [STRICT_REGISTRY, TOLERANT_REGISTRY]) {
      expect(registry.invalidEntry("widgets", nameless)).toContain("name");
      expect(registry.invalidEntry("widgets", placement({ opacity: 2 }))).toContain("opacity");
      expect(registry.invalidEntry("widgets", "a placement")).not.toBeNull();
    }
  });

  test("a field this build does not know is refused by the engine and kept by a client", () => {
    const newer = { ...placement(), blendMode: "multiply" };
    expect(STRICT_REGISTRY.invalidEntry("widgets", newer)).toContain("blendMode");
    expect(TOLERANT_REGISTRY.invalidEntry("widgets", newer)).toBeNull();
  });

  test("create fills in the defaults and refuses a seed missing what has none", () => {
    const created = STRICT_REGISTRY.create("widgets", "widget", {
      widget: "woofx3:widget:text",
      width: 10,
      height: 10,
      z: "a0",
    });
    expect(created).toMatchObject({ x: 0, visible: true, opacity: 1, settings: {}, extra: {} });
    expect(() => STRICT_REGISTRY.create("widgets", "widget", { widget: "woofx3:widget:text" })).toThrow();
  });
});

describe("behaviors", () => {
  test("host and widget-declared kinds", () => {
    expect(STRICT_REGISTRY.invalidEntry("behaviors", transition())).toBeNull();
    expect(STRICT_REGISTRY.invalidEntry("behaviors", transition({ kind: "typewriter" }))).toBeNull();
    expect(STRICT_REGISTRY.executorOf("transition", "fade")).toBe("host");
    expect(STRICT_REGISTRY.executorOf("transition", "typewriter")).toBe("widget");
    expect(STRICT_REGISTRY.executorOf("activity", "typewriter")).toBeNull();
    expect(STRICT_REGISTRY.invalidEntry("behaviors", transition({ kind: "Not A Token" }))).not.toBeNull();
  });

  test("a transition needs a phase and a bounded duration", () => {
    expect(STRICT_REGISTRY.invalidEntry("behaviors", transition({ params: {} }))).toContain("phase");
    expect(STRICT_REGISTRY.invalidEntry("behaviors", transition({ params: { phase: "sideways" } }))).toContain("phase");
    const tooLong = transition({ timing: { ...transition().timing, durationMs: MAX_TRANSITION_MS + 1 } });
    expect(STRICT_REGISTRY.invalidEntry("behaviors", tooLong)).toContain("transition lasts");
    const untilExit = transition({ timing: { ...transition().timing, durationMs: "until-exit" } });
    expect(STRICT_REGISTRY.invalidEntry("behaviors", untilExit)).not.toBeNull();
  });

  test("only a slide takes a direction, and the engine refuses a param a host kind does not take", () => {
    const slide = transition({ kind: "slide", params: { phase: "in", direction: "left" } });
    expect(STRICT_REGISTRY.invalidEntry("behaviors", slide)).toBeNull();
    expect(
      STRICT_REGISTRY.invalidEntry("behaviors", { ...slide, params: { phase: "in", direction: "diagonal" } })
    ).toContain("direction");
    const fadeWithDirection = transition({ params: { phase: "in", direction: "left" } });
    expect(STRICT_REGISTRY.invalidEntry("behaviors", fadeWithDirection)).toContain("direction");
    expect(TOLERANT_REGISTRY.invalidEntry("behaviors", fadeWithDirection)).toBeNull();
  });

  test("a widget-declared kind keeps whatever params the widget takes", () => {
    const own = transition({ kind: "typewriter", params: { phase: "in", cursor: true } });
    expect(STRICT_REGISTRY.invalidEntry("behaviors", own)).toBeNull();
  });

  test("timing is checked field by field", () => {
    const base = transition().timing;
    for (const timing of [
      { ...base, anchor: "midway" },
      { ...base, offsetMs: 1.5 },
      { ...base, easing: "cubic-bezier(0,0,1,1)" },
      { ...base, node: "" },
    ]) {
      expect(STRICT_REGISTRY.invalidEntry("behaviors", { ...transition(), timing })).toContain("timing");
    }
    const extraKey = { ...transition(), timing: { ...base, jitter: 3 } };
    expect(STRICT_REGISTRY.invalidEntry("behaviors", extraKey)).toContain("timing");
    expect(TOLERANT_REGISTRY.invalidEntry("behaviors", extraKey)).toBeNull();
  });

  test("an activity targets a widget, never the canvas", () => {
    const activity = STRICT_REGISTRY.create("behaviors", "activity", { target: "w1" });
    expect(activity).toMatchObject({ kind: "window", timing: { anchor: "start", durationMs: "until-exit" } });
    expect(STRICT_REGISTRY.invalidEntry("behaviors", { ...activity, target: "canvas" })).toContain("canvas");
    expect(STRICT_REGISTRY.invalidEntry("behaviors", { ...transition(), target: "canvas" })).toBeNull();
  });

  test("effects take their kind's params and last some time", () => {
    const shake = STRICT_REGISTRY.create("behaviors", "effect", { target: "w1", kind: "shake" });
    expect(STRICT_REGISTRY.invalidEntry("behaviors", { ...shake, params: { distancePx: 12 } })).toBeNull();
    expect(STRICT_REGISTRY.invalidEntry("behaviors", { ...shake, params: { distancePx: -1 } })).toContain("distancePx");
    const instant = { ...shake, timing: { ...(shake.timing as object), durationMs: 0 } };
    expect(STRICT_REGISTRY.invalidEntry("behaviors", instant)).toContain("lasts");
  });

  test("transition defaults follow the phase", () => {
    const out = STRICT_REGISTRY.create("behaviors", "transition", {
      target: "w1",
      kind: "slide",
      params: { phase: "out" },
    });
    expect(out).toMatchObject({
      timing: { anchor: "exit", easing: "ease-in" },
      params: { phase: "out", direction: "up" },
    });
  });

  test("an unknown type is refused by the engine and kept by a client", () => {
    const future = { ...transition(), type: "sound", kind: "chime", params: { volume: 1 } };
    expect(STRICT_REGISTRY.invalidEntry("behaviors", future)).toContain("unknown behavior type");
    expect(TOLERANT_REGISTRY.invalidEntry("behaviors", future)).toBeNull();
    expect(TOLERANT_REGISTRY.invalidEntry("behaviors", { kind: "chime" })).not.toBeNull();
  });

  test("a type is registered once, and extra types join the built-in ones", () => {
    const sound: EntityType = {
      collection: "behaviors",
      name: "sound",
      invalid: () => null,
      withDefaults: (seed) => seed,
      schema: () => ({}),
    };
    const registry = createRegistry("strict", [sound]);
    expect(registry.invalidEntry("behaviors", { ...transition(), type: "sound" })).toBeNull();
    expect(() => createRegistry("strict", [{ ...sound, name: "transition" }])).toThrow();
  });
});

describe("field changes", () => {
  test("a field replace is checked on its own, and a fixed field only changes with its entry", () => {
    expect(STRICT_REGISTRY.invalidField("behaviors", "kind", "slide")).toBeNull();
    expect(STRICT_REGISTRY.invalidField("behaviors", "kind", 3)).not.toBeNull();
    expect(STRICT_REGISTRY.invalidField("behaviors", "type", "effect")).toContain("whole");
    expect(STRICT_REGISTRY.invalidField("behaviors", "colour", "red")).toContain("no field");
  });

  test("a timing field is replaced, and only the optional node is inserted or removed", () => {
    const replace = { inserts: true, removes: true };
    expect(STRICT_REGISTRY.invalidSubfield("behaviors", "timing", "offsetMs", { ...replace, value: 250 })).toBeNull();
    expect(
      STRICT_REGISTRY.invalidSubfield("behaviors", "timing", "offsetMs", { inserts: false, removes: true, value: 0 })
    ).toContain("only be replaced");
    expect(
      STRICT_REGISTRY.invalidSubfield("behaviors", "timing", "node", { inserts: true, removes: false, value: "w2" })
    ).toBeNull();
    expect(STRICT_REGISTRY.invalidSubfield("behaviors", "timing", "pace", { ...replace, value: 1 })).toContain(
      "no field"
    );
    expect(STRICT_REGISTRY.invalidSubfield("behaviors", "params", "phase", { ...replace, value: "in" })).not.toBeNull();
  });
});

describe("documents", () => {
  test("a document without behaviors gets an empty collection", () => {
    const doc = normalizeComposition({ layout: {}, widgets: {} });
    expect(doc).toEqual({ layout: {}, widgets: {}, behaviors: {} });
    expect(normalizeComposition({ layout: {}, widgets: {}, behaviors: [] })).toBeNull();
    expect(normalizeComposition({ layout: {} })).toBeNull();
  });

  test("withoutWidget removes the widget and the behaviors that target it", () => {
    const doc: CompositionDocument = {
      layout: {},
      widgets: { w1: placement(), w2: placement({ z: "a1" }) },
      behaviors: {
        in: transition(),
        other: transition({ target: "w2" }),
        canvas: transition({ target: "canvas" }),
      },
    };
    const next = withoutWidget(doc, "w1");
    expect(Object.keys(next.widgets)).toEqual(["w2"]);
    expect(Object.keys(next.behaviors).sort()).toEqual(["canvas", "other"]);
    expect(Object.keys(doc.widgets)).toEqual(["w1", "w2"]);
  });

  test("a placement's legacy transitions migrate into behaviors, once", () => {
    const legacy = placement({
      extra: {
        transitionIn: { type: "slide", durationMs: 300, direction: "left" },
        transitionOut: { type: "fade", durationMs: 99999 },
        keep: 1,
      },
    });
    const doc: CompositionDocument = { layout: {}, widgets: { w1: legacy }, behaviors: {} };
    const migrated = STRICT_REGISTRY.migrateDocument(doc);
    const id = legacyTransitionId("w1", "in");
    expect(migrated.behaviors[id]).toEqual({
      type: "transition",
      kind: "slide",
      target: "w1",
      order: "a0",
      timing: { anchor: "enter", offsetMs: 0, durationMs: 300, easing: "ease-out" },
      params: { phase: "in", direction: "left" },
    });
    expect(STRICT_REGISTRY.invalidEntry("behaviors", migrated.behaviors[id])).toBeNull();
    // Out of range: kept as it was rather than lost.
    expect(migrated.widgets.w1.extra).toEqual({ transitionOut: { type: "fade", durationMs: 99999 }, keep: 1 });
    expect(STRICT_REGISTRY.migrateDocument(migrated)).toEqual(migrated);
    expect(doc.widgets.w1.extra.transitionIn).toBeDefined();
  });
});

describe("edits", () => {
  function doc(): CompositionDocument {
    return { layout: { width: 1920, height: 1080 }, widgets: { w: placement() }, behaviors: { t: transition() } };
  }

  test("every entry an edit adds or changes is checked, and entries it left alone are not", () => {
    const before = doc();
    before.widgets.broken = placement({ opacity: 7 });
    const moved = { ...before, widgets: { ...before.widgets, w: placement({ x: 10 }) } };
    expect(STRICT_REGISTRY.invalidEdit(before, moved)).toBeNull();
    const spoiled = { ...before, widgets: { ...before.widgets, w: placement({ opacity: 2 }) } };
    expect(STRICT_REGISTRY.invalidEdit(before, spoiled)).toContain("placement w would not be valid");
    const longId = { ...before, behaviors: { ...before.behaviors, ["b".repeat(200)]: transition() } };
    expect(STRICT_REGISTRY.invalidEdit(before, longId)).toContain("id is 1 to");
    const shapeless = { layout: {}, widgets: {} } as unknown as CompositionDocument;
    expect(STRICT_REGISTRY.invalidEdit(before, shapeless)).not.toBeNull();
  });

  test("the canvas keeps a positive size; a layout the edit left alone is not checked", () => {
    const before = doc();
    const resized = (layout: Record<string, unknown>) => ({ ...before, layout });
    expect(
      STRICT_REGISTRY.invalidEdit(before, resized({ width: 1280, height: 720, backgroundColor: "#000" }))
    ).toBeNull();
    expect(STRICT_REGISTRY.invalidEdit(before, resized({ width: 0, height: 1080 }))).toContain("positive");
    expect(TOLERANT_REGISTRY.invalidEdit(before, resized({ width: 1920, height: -5 }))).toContain("positive");
    expect(STRICT_REGISTRY.invalidEdit(before, resized({ width: Number.NaN, height: 1080 }))).toContain("positive");
    expect(STRICT_REGISTRY.invalidEdit(before, resized({ width: "wide", height: 1080 }))).toContain("positive");
    expect(STRICT_REGISTRY.invalidEdit(before, resized({ height: 1080 }))).toContain("keeps its width");
    expect(STRICT_REGISTRY.invalidEdit(before, resized({ ...before.layout, backgroundColor: 3 }))).toContain(
      "backgroundColor"
    );
    expect(STRICT_REGISTRY.invalidEdit(before, resized({ ...before.layout, grid: { size: 8 } }))).toBeNull();

    const sizeless = { ...before, layout: { width: 0, height: 1080 } };
    const moved = { ...sizeless, widgets: { w: placement({ x: 10 }) } };
    expect(STRICT_REGISTRY.invalidEdit(sizeless, moved)).toBeNull();
  });

  test("tryCreate refuses what create throws on", () => {
    expect(STRICT_REGISTRY.tryCreate("behaviors", "effect", { target: "w1", kind: "no such kind" })).toEqual({
      ok: false,
      detail: "invalid behavior kind",
    });
    expect(STRICT_REGISTRY.tryCreate("behaviors", "sound", { target: "w1" }).ok).toBe(false);
    expect(STRICT_REGISTRY.tryCreate("behaviors", "effect", { target: "w1", kind: "shake" }).ok).toBe(true);
  });

  test("an unknown behavior type is an edit only a tolerant registry takes", () => {
    const before = doc();
    const after = {
      ...before,
      behaviors: { ...before.behaviors, s: { ...transition(), type: "sound", kind: "chime" } },
    };
    expect(STRICT_REGISTRY.invalidEdit(before, after)).toContain("unknown behavior type");
    expect(TOLERANT_REGISTRY.invalidEdit(before, after)).toBeNull();
  });
});

describe("widget traits", () => {
  test("bundled widgets declare theirs, and an undeclared widget has the defaults", () => {
    expect(STRICT_REGISTRY.widgetTraits("woofx3:widget:text")).toEqual({ keepsAspect: false, heightFollowsText: true });
    expect(TOLERANT_REGISTRY.widgetTraits("woofx3:widget:video")).toEqual(DEFAULT_WIDGET_TRAITS);
    expect(STRICT_REGISTRY.widgetTraits("example:widget:clock")).toEqual(DEFAULT_WIDGET_TRAITS);
  });

  test("a module's widget declares its traits once, and cannot redefine a bundled widget's", () => {
    const registry = createRegistry("tolerant", [], { "example:widget:photo": { keepsAspect: true } });
    expect(registry.widgetTraits("example:widget:photo").keepsAspect).toBe(true);
    expect(() => createRegistry("tolerant", [], { "woofx3:widget:text": { keepsAspect: true } })).toThrow(/once/);
  });
});

describe("effect param specs", () => {
  const effect = (kind: string, params: Record<string, unknown>): BehaviorDocument => ({
    type: "effect",
    kind,
    target: "w",
    order: "a0",
    timing: { anchor: "enter", offsetMs: 0, durationMs: "until-exit", easing: "ease-in-out" },
    params,
  });

  test("every host effect lists its params with the defaults the overlay plays", () => {
    for (const kind of HOST_EFFECT_KINDS) {
      const specs = effectParamSpecs(kind);
      expect(specs.map((spec) => spec.name).sort()).toEqual(Object.keys(EFFECT_DEFAULTS[kind]).sort());
      for (const spec of specs) {
        expect(spec.defaultValue).toBe((EFFECT_DEFAULTS[kind] as Record<string, number | string>)[spec.name]);
      }
    }
    expect(effectParamSpecs("pulse")[0]).toMatchObject({ name: "scale", label: "Scale", min: 1, max: 3, unit: "×" });
    expect(effectParamSpecs("blur")[0]).toMatchObject({ name: "radiusPx", min: 0, minExclusive: true, max: 200 });
    expect(effectParamSpecs("glow").map((spec) => spec.input)).toEqual(["color", "number", "number"]);
    expect(effectParamSpecs("sparkle")).toEqual([]);
  });

  test("the registry accepts exactly what the specs allow", () => {
    for (const kind of HOST_EFFECT_KINDS) {
      for (const spec of effectParamSpecs(kind)) {
        const check = (value: unknown) =>
          STRICT_REGISTRY.invalidEntry("behaviors", effect(kind, { [spec.name]: value }));
        expect(check(spec.defaultValue)).toBeNull();
        if (spec.input === "color") {
          expect(check("red")).not.toBeNull();
          continue;
        }
        if (spec.max !== undefined) {
          expect(check(spec.max)).toBeNull();
          expect(check(spec.max + 1)).not.toBeNull();
        }
        if (spec.min !== undefined) {
          if (spec.minExclusive) {
            expect(check(spec.min)).not.toBeNull();
          } else {
            expect(check(spec.min)).toBeNull();
          }
          expect(check(spec.min - 1)).not.toBeNull();
        }
      }
    }
  });
});
