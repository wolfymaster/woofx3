import { describe, expect, test } from "bun:test";
import {
  compileAnimation,
  declaresKind,
  EFFECT_DEFAULTS,
  HOST_EFFECT_KINDS,
  isDeclaredBehaviorKinds,
  NO_DECLARED_KINDS,
  STRICT_REGISTRY,
} from "../model";

// The registry decides which params a host effect may carry, and animation.ts
// reads them; a kind or param known to one and not the other would either be
// refused although playable or accepted and then thrown on at play time.
describe("host effect kinds", () => {
  for (const kind of HOST_EFFECT_KINDS) {
    test(`${kind}: every param animation.ts reads is accepted at its default`, () => {
      const params = { ...EFFECT_DEFAULTS[kind] };
      const behavior = STRICT_REGISTRY.create("behaviors", "effect", { kind, target: "w1", params });
      expect(STRICT_REGISTRY.invalidEntry("behaviors", behavior)).toBeNull();
      expect(compileAnimation(behavior as never, { startMs: 0, endMs: 1000 })).not.toBeNull();
    });
  }
});

describe("declaresKind", () => {
  const declared = { transitions: ["typewriter"], effects: ["sparkle"] };

  test("looks a kind up under its behavior type", () => {
    expect(declaresKind(declared, "transition", "typewriter")).toBe(true);
    expect(declaresKind(declared, "effect", "sparkle")).toBe(true);
    expect(declaresKind(declared, "effect", "typewriter")).toBe(false);
    expect(declaresKind(declared, "activity", "typewriter")).toBe(false);
    expect(declaresKind(NO_DECLARED_KINDS, "transition", "typewriter")).toBe(false);
  });

  test("the wire shape is checked", () => {
    expect(isDeclaredBehaviorKinds(declared)).toBe(true);
    expect(isDeclaredBehaviorKinds({ transitions: [] })).toBe(false);
    expect(isDeclaredBehaviorKinds({ transitions: ["Not A Kind"], effects: [] })).toBe(false);
  });
});
