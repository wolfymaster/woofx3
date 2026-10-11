import { describe, expect, it } from "bun:test";
import type { WidgetBehaviorState } from "@woofx3/module-sdk";
import type { BehaviorDocument, CompositionDocument } from "@woofx3/scene/model";
import type { DelegatedBehavior } from "@woofx3/scene/runtime";
import { BehaviorRelay, behaviorStateOf, entranceOf } from "../../public/scene-manager/widget-behaviors";

function delegated(overrides: Partial<DelegatedBehavior> = {}): DelegatedBehavior {
  return {
    behavior: "b1",
    type: "transition",
    kind: "typewriter",
    phase: "in",
    startMs: 100,
    endMs: 900,
    easing: "ease-out",
    params: { phase: "in" },
    ...overrides,
  };
}

function relay() {
  const sent: Array<[string, WidgetBehaviorState | null]> = [];
  return { sent, relay: new BehaviorRelay((id, state) => sent.push([id, state])) };
}

describe("behaviorStateOf", () => {
  it("carries a transition with its phase and length, and an open-ended effect with none", () => {
    expect(behaviorStateOf(delegated())).toEqual({
      type: "transition",
      kind: "typewriter",
      phase: "in",
      durationMs: 800,
      easing: "ease-out",
      params: { phase: "in" },
    });
    expect(
      behaviorStateOf(delegated({ type: "effect", kind: "sparkle", phase: null, endMs: null, params: { size: 2 } }))
    ).toEqual({ type: "effect", kind: "sparkle", durationMs: null, easing: "ease-out", params: { size: 2 } });
  });

  it("is null for what the protocol cannot carry", () => {
    expect(behaviorStateOf(delegated({ phase: null }))).toBeNull();
    expect(behaviorStateOf(delegated({ type: "activity", phase: null }))).toBeNull();
  });
});

describe("entranceOf", () => {
  const behavior = (overrides: Partial<BehaviorDocument>): BehaviorDocument => ({
    type: "transition",
    kind: "typewriter",
    target: "w1",
    order: "a1",
    timing: { anchor: "enter", offsetMs: 0, durationMs: 600, easing: "ease-out" },
    params: { phase: "in" },
    ...overrides,
  });
  const doc = (behaviors: Record<string, BehaviorDocument>): CompositionDocument => ({
    layout: { width: 10, height: 10 },
    widgets: {},
    behaviors,
  });

  it("is the first of the widget's own in-transitions on it, by order", () => {
    const entrance = entranceOf(
      doc({
        fade: behavior({ kind: "fade", order: "a0" }),
        wave: behavior({ kind: "wave", order: "a2" }),
        typewriter: behavior({}),
        other: behavior({ target: "w2", order: "a0" }),
        out: behavior({ order: "a0", params: { phase: "out" } }),
      }),
      "w1",
      () => true
    );
    expect(entrance).toEqual({
      type: "transition",
      kind: "typewriter",
      phase: "in",
      durationMs: 600,
      easing: "ease-out",
      params: { phase: "in" },
    });
  });

  it("skips a kind the widget does not declare", () => {
    const entrance = entranceOf(
      doc({ typewriter: behavior({ order: "a0" }), wave: behavior({ kind: "wave", order: "a1" }) }),
      "w1",
      (type, kind) => type === "transition" && kind === "wave"
    );
    expect(entrance?.kind).toBe("wave");
  });

  it("is null without one", () => {
    expect(entranceOf(doc({ fade: behavior({ kind: "fade" }) }), "w1", () => true)).toBeNull();
  });
});

describe("BehaviorRelay", () => {
  it("sends a behavior as it starts, and not again when only its end becomes known", () => {
    const { sent, relay: r } = relay();
    r.handle("w1", {
      kind: "start",
      delegated: delegated({ type: "effect", phase: null, kind: "glow2", endMs: null }),
    });
    r.handle("w1", {
      kind: "start",
      delegated: delegated({ type: "effect", phase: null, kind: "glow2", endMs: 5_000 }),
    });
    expect(sent.map(([id, state]) => [id, state?.kind, state?.durationMs])).toEqual([["w1", "glow2", null]]);
  });

  it("on a withdrawal clears the widget and tells it again what it still plays", () => {
    const { sent, relay: r } = relay();
    const effect = delegated({ behavior: "e1", type: "effect", phase: null, kind: "sparkle", endMs: null });
    r.handle("w1", { kind: "start", delegated: delegated({ behavior: "in" }) });
    r.handle("w1", { kind: "start", delegated: effect });
    r.handle("w1", {
      kind: "start",
      delegated: delegated({ behavior: "out", phase: "out", startMs: 4_000, endMs: 4_500 }),
    });
    sent.length = 0;

    r.handle("w1", { kind: "cancel", behavior: "out" });

    expect(
      sent.map(([, state]) => (state === null ? null : `${state.type}:${state.kind}:${state.phase ?? ""}`))
    ).toEqual([null, "transition:typewriter:in", "effect:sparkle:"]);
    expect(r.ongoing("w1").map((state) => state.kind)).toEqual(["sparkle"]);
  });

  it("forgets a widget that is gone, and ignores withdrawing what it never sent", () => {
    const { sent, relay: r } = relay();
    r.handle("w1", { kind: "start", delegated: delegated() });
    r.forget("w1");
    r.handle("w1", { kind: "cancel", behavior: "b1" });
    expect(sent).toHaveLength(1);
    expect(r.ongoing("w1")).toEqual([]);
  });
});
