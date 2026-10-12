import { describe, expect, test } from "bun:test";
import {
  type AnimationKeyframe,
  type AnimationSpec,
  type BehaviorDocument,
  compileAnimation,
  EFFECT_DEFAULTS,
  HOST_EFFECT_KINDS,
  HOST_TRANSITION_KINDS,
  isHostKind,
  LAYER_PROPERTIES,
  TRANSITION_DIRECTIONS,
} from "../model";

function behavior(type: string, kind: string, params: Record<string, unknown> = {}): BehaviorDocument {
  return {
    type,
    kind,
    target: "w1",
    order: "a0",
    timing: { anchor: "enter", offsetMs: 0, durationMs: 400, easing: "ease-out" },
    params,
  };
}

function compile(type: string, kind: string, params: Record<string, unknown> = {}, endMs: number | null = 1_400) {
  const spec = compileAnimation(behavior(type, kind, params), { startMs: 1_000, endMs });
  if (spec === null) {
    throw new Error(`expected the host to play ${type} ${kind}`);
  }
  return spec;
}

function propertiesOf(frame: AnimationKeyframe): string[] {
  return Object.keys(frame)
    .filter((key) => key !== "offset")
    .sort();
}

/** Every frame stays within its layer and names the same properties. */
function expectWellFormed(spec: AnimationSpec): void {
  const allowed = LAYER_PROPERTIES[spec.layer] as readonly string[];
  const first = propertiesOf(spec.keyframes[0]);
  expect(first.length).toBeGreaterThan(0);
  for (const frame of spec.keyframes) {
    for (const property of propertiesOf(frame)) {
      expect(allowed).toContain(property);
    }
    expect(propertiesOf(frame)).toEqual(first);
    if (frame.offset !== undefined) {
      expect(frame.offset).toBeGreaterThan(0);
      expect(frame.offset).toBeLessThan(1);
    }
  }
  const offsets = spec.keyframes.map((frame) => frame.offset).filter((offset) => offset !== undefined);
  expect(offsets).toEqual([...offsets].sort());
}

describe("layers", () => {
  test("wrappers animate only compositor properties, and only an effect never touches opacity", () => {
    expect(LAYER_PROPERTIES.transition).toEqual(["transform", "opacity", "filter"]);
    expect(LAYER_PROPERTIES.effect).toEqual(["transform", "filter"]);
  });
});

describe("transitions", () => {
  for (const kind of HOST_TRANSITION_KINDS) {
    test(`${kind} enters from hidden to shown and leaves from shown to hidden`, () => {
      const enter = compile("transition", kind, { phase: "in" });
      const leave = compile("transition", kind, { phase: "out" });
      for (const spec of [enter, leave]) {
        expect(spec.layer).toBe("transition");
        expectWellFormed(spec);
        expect(spec.timing).toEqual({ duration: 400, easing: "ease-out", delay: 1_000, fill: "both", iterations: 1 });
      }
      expect(enter.keyframes[0].opacity).toBe(0);
      expect(enter.keyframes.at(-1)).toMatchObject({ opacity: 1, transform: "none" });
      expect(leave.keyframes[0]).toMatchObject({ opacity: 1, transform: "none" });
      expect(leave.keyframes.at(-1)?.opacity).toBe(0);
      if (kind !== "slide") {
        // An exit is the entrance played backwards.
        const reversed = enter.keyframes
          .slice()
          .reverse()
          .map((frame) => (frame.offset === undefined ? frame : { ...frame, offset: 1 - frame.offset }));
        expect(leave.keyframes).toEqual(reversed);
      }
    });
  }

  test("a fade only fades", () => {
    expect(compile("transition", "fade", { phase: "in" }).keyframes).toEqual([
      { opacity: 0, transform: "none" },
      { opacity: 1, transform: "none" },
    ]);
  });

  test("only blur filters", () => {
    for (const kind of HOST_TRANSITION_KINDS) {
      const filters = compile("transition", kind, { phase: "in" }).keyframes.some((frame) => "filter" in frame);
      expect(filters).toBe(kind === "blur");
    }
    expect(compile("transition", "blur", { phase: "in" }).keyframes[0].filter).toBe("blur(16px)");
  });

  test("a slide enters from the opposite side and leaves the way it points", () => {
    const expected = {
      up: ["translate(0, 100%)", "translate(0, -100%)"],
      down: ["translate(0, -100%)", "translate(0, 100%)"],
      left: ["translate(100%, 0)", "translate(-100%, 0)"],
      right: ["translate(-100%, 0)", "translate(100%, 0)"],
    };
    for (const direction of TRANSITION_DIRECTIONS) {
      const enter = compile("transition", "slide", { phase: "in", direction });
      const leave = compile("transition", "slide", { phase: "out", direction });
      expect(enter.keyframes[0].transform).toBe(expected[direction][0]);
      expect(leave.keyframes.at(-1)?.transform).toBe(expected[direction][1]);
    }
    expect(compile("transition", "slide", { phase: "in" }).keyframes[0].transform).toBe("translate(0, 100%)");
  });

  test("intermediate offsets are mirrored on exit", () => {
    expect(compile("transition", "pop", { phase: "out" }).keyframes[1].offset).toBeCloseTo(0.3);
    expect(compile("transition", "bounce", { phase: "out" }).keyframes.map((frame) => frame.offset)).toEqual([
      undefined,
      0.25,
      0.5,
      undefined,
    ]);
  });

  test("malformed transitions fail fast", () => {
    expect(() => compile("transition", "fade", {})).toThrow(/phase/);
    expect(() => compile("transition", "slide", { phase: "in", direction: "sideways" })).toThrow(/direction/);
    expect(() => compile("transition", "fade", { phase: "in" }, null)).toThrow(/end/);
    expect(() => compile("transition", "fade", { phase: "in" }, 999)).toThrow(/endMs/);
  });
});

describe("effects", () => {
  for (const kind of HOST_EFFECT_KINDS) {
    test(`${kind} plays on the effect wrapper within its window`, () => {
      const spec = compile("effect", kind);
      expect(spec.layer).toBe("effect");
      expectWellFormed(spec);
      expect(spec.timing.fill).toBe("none");
      expect(spec.timing.delay).toBe(1_000);
      expect(spec.timing.duration * spec.timing.iterations).toBeCloseTo(400);
    });
  }

  test("a repeating effect plays whole cycles over its window", () => {
    const spec = compile("effect", "pulse", { periodMs: 250, scale: 1.2 }, 2_000);
    expect(spec.timing.duration).toBe(250);
    expect(spec.timing.iterations).toBe(4);
    expect(spec.keyframes[1].transform).toBe("scale(1.2)");
  });

  test("an effect with no end repeats forever", () => {
    const shake = compile("effect", "shake", {}, null);
    expect(shake.timing.duration).toBe(EFFECT_DEFAULTS.shake.periodMs);
    expect(shake.timing.iterations).toBe(Number.POSITIVE_INFINITY);
    const blur = compile("effect", "blur", {}, null);
    expect(blur.timing.duration).toBe(Number.POSITIVE_INFINITY);
    expect(blur.timing.iterations).toBe(1);
  });

  test("params tune effects and defaults fill the rest", () => {
    expect(compile("effect", "shake", { distancePx: 4 }).keyframes[1].transform).toBe("translateX(-4px)");
    expect(compile("effect", "glow", { color: "#ff00aa", radiusPx: 20 }).keyframes[1].filter).toBe(
      "drop-shadow(0 0 20px #ff00aa)"
    );
    expect(compile("effect", "glow").keyframes[1].filter).toBe("drop-shadow(0 0 12px #ffffff)");
    expect(compile("effect", "blur", { radiusPx: 3 }).keyframes[0].filter).toBe("blur(3px)");
  });

  test("malformed params fail fast", () => {
    expect(() => compile("effect", "shake", { distancePx: -1 })).toThrow(/distancePx/);
    expect(() => compile("effect", "pulse", { periodMs: "fast" })).toThrow(/periodMs/);
    expect(() => compile("effect", "glow", { color: "red); background: url(x)" })).toThrow(/colour/);
  });
});

describe("kinds the host does not play", () => {
  test("a widget's own kind is delegated to the widget", () => {
    expect(isHostKind("transition", "typewriter")).toBe(false);
    expect(
      compileAnimation(behavior("transition", "typewriter", { phase: "in" }), { startMs: 0, endMs: 100 })
    ).toBeNull();
    expect(compileAnimation(behavior("effect", "sparkle"), { startMs: 0, endMs: 100 })).toBeNull();
  });

  test("activities and unknown types are not animated", () => {
    expect(compileAnimation(behavior("activity", "fade"), { startMs: 0, endMs: 100 })).toBeNull();
    expect(compileAnimation(behavior("future-type", "fade"), { startMs: 0, endMs: 100 })).toBeNull();
  });

  test("blur is a host kind both as a transition and as an effect", () => {
    expect(isHostKind("transition", "blur")).toBe(true);
    expect(isHostKind("effect", "blur")).toBe(true);
    expect(isHostKind("effect", "fade")).toBe(false);
  });
});
