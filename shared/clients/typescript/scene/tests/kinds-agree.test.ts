import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  compileAnimation,
  declaresKind,
  EFFECT_DEFAULTS,
  HOST_EFFECT_KINDS,
  HOST_TRANSITION_KINDS,
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

// Barkloader refuses a widget declaring a host kind as its own; a host kind it
// does not know of would let a widget shadow one the overlay plays.
describe("host kinds as barkloader knows them", () => {
  const manifestRs = readFileSync(
    join(import.meta.dir, "../../../../../barkloader/lib_module/src/module_manifest.rs"),
    "utf8"
  );
  const rustKinds = (name: string): string[] => {
    const match = new RegExp(`pub const ${name}: \\[&str; \\d+\\] =\\s*\\[([^\\]]*)\\]`).exec(manifestRs);
    if (match === null) {
      throw new Error(`module_manifest.rs has no ${name}`);
    }
    return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  };

  test("match the model's", () => {
    expect(rustKinds("HOST_TRANSITION_KINDS")).toEqual([...HOST_TRANSITION_KINDS]);
    expect(rustKinds("HOST_EFFECT_KINDS")).toEqual([...HOST_EFFECT_KINDS]);
  });
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
