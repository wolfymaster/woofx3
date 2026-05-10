// Drift guard: scans the Rust runtime adapters that build `ctx` and
// asserts every namespace + every JS-facing property name they
// register also appears in `function-ctx.d.ts` and `function-ctx.lua`.
//
// Goal: prevent silent surface drift between the Rust source of truth
// and the hand-maintained type declarations consumed by module
// authors. When this test fails, either:
//
//   1. The Rust source added a new ctx surface — update the .d.ts and
//      .lua to match.
//   2. The Rust source removed a surface — same.
//   3. The regex picked up something unrelated — tighten the regex
//      below (but prefer to keep it permissive — false positives are
//      cheaper than missed drift).

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..", "..");

function readRust(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), "utf8");
}

const dts = readFileSync(join(import.meta.dir, "..", "src", "function-ctx.d.ts"), "utf8");
const lua = readFileSync(join(import.meta.dir, "..", "src", "function-ctx.lua"), "utf8");

/**
 * Property registrations on a ctx-namespace object look like:
 *   xxx.set("publish", …)
 *   xxx.set("get", …)
 * etc. We scan the QuickJS adapter (the JS-facing source of truth) for
 * `obj.set("name", …)` calls inside `build_*_namespace` / extension
 * binders. The Lua adapter mirrors this 1:1 — confirmed by reading
 * `runtime/lua.rs:63-192`.
 */
function extractRustProperties(src: string): Set<string> {
  const out = new Set<string>();
  // Match `<obj>.set("name", …)` — the `set` is gorm-untyped so the
  // pattern catches everything we register.
  const re = /\.set\(\s*"([a-zA-Z_][a-zA-Z0-9_]*)"\s*,/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex iteration
  while ((m = re.exec(src)) !== null) {
    out.add(m[1]!);
  }
  return out;
}

const KNOWN_TOP_LEVEL = new Set([
  // Built-in built by quickjs.rs:185-206
  "event",
  "user",
  "events",
  "storage",
  "http",
  "env",
  "resources",
]);

const KNOWN_NESTED: Record<string, string[]> = {
  events: ["publish"],
  storage: ["get", "set"],
  http: ["request"],
  env: ["get"],
  resources: ["create", "delete", "list"],
};

const KNOWN_EXTENSIONS: Record<string, string[]> = {
  twitch: ["clip", "timeout", "updateStream", "addModerator"],
  chat: ["sendMessage"],
  // platform.alerts and platform.chat — the dotted namespace is built
  // by `ensure_namespace_object` (quickjs.rs:209-229).
  "platform.alerts": ["alert", "setTimer"],
  "platform.chat": ["register"],
};

describe("function ctx drift guard", () => {
  it("every property the QuickJS adapter registers is documented in function-ctx.d.ts", () => {
    const rust = readRust("barkloader/lib_sandbox/src/runtime/quickjs.rs");
    const props = extractRustProperties(rust);
    // The base set we already know about. Anything else we find is
    // either a new surface to type, or an internal helper. Failing the
    // test forces a human to triage.
    const documented = new Set<string>();
    for (const k of KNOWN_TOP_LEVEL) documented.add(k);
    for (const ks of Object.values(KNOWN_NESTED)) for (const k of ks) documented.add(k);
    for (const ks of Object.values(KNOWN_EXTENSIONS)) for (const k of ks) documented.add(k);

    const undocumented: string[] = [];
    for (const p of props) {
      if (!documented.has(p)) undocumented.push(p);
    }
    if (undocumented.length > 0) {
      throw new Error(
        `QuickJS adapter registers ${undocumented.length} ctx properties not in the documented set:\n  ` +
          undocumented.sort().join(", ") +
          "\nUpdate src/function-ctx.d.ts + src/function-ctx.lua + KNOWN_* in this test.",
      );
    }
  });

  it("the .d.ts mentions every documented top-level namespace", () => {
    for (const ns of KNOWN_TOP_LEVEL) {
      // Each top-level namespace appears as either a property on the
      // Ctx interface or as a referenced type. Scan permissively.
      const found = dts.includes(`${ns}:`) || dts.includes(`Ctx${ns[0]!.toUpperCase() + ns.slice(1)}`);
      expect(found).toBe(true);
    }
  });

  it("the .d.ts mentions every documented nested method name", () => {
    for (const [ns, methods] of Object.entries(KNOWN_NESTED)) {
      for (const m of methods) {
        const re = new RegExp(`${m}\\s*\\(|${m}:\\s*fun\\(|"${m}"`);
        if (!re.test(dts)) {
          throw new Error(`function-ctx.d.ts is missing ${ns}.${m}`);
        }
      }
    }
  });

  it("the .lua annotations mention every documented method name", () => {
    for (const [ns, methods] of Object.entries(KNOWN_NESTED)) {
      for (const m of methods) {
        if (!lua.includes(`${m} `) && !lua.includes(`${m}:`)) {
          throw new Error(`function-ctx.lua is missing ${ns}.${m}`);
        }
      }
    }
  });

  it("the .d.ts mentions every documented extension method", () => {
    for (const [ns, methods] of Object.entries(KNOWN_EXTENSIONS)) {
      for (const m of methods) {
        if (!dts.includes(`${m}(`)) {
          throw new Error(`function-ctx.d.ts is missing ${ns}.${m}`);
        }
      }
    }
  });

  it("Rust runtime adapters share the same registered namespaces", () => {
    // Sanity: both adapters should register the same top-level keys
    // (the contract is the same regardless of runtime).
    const quickjs = readRust("barkloader/lib_sandbox/src/runtime/quickjs.rs");
    const lua = readRust("barkloader/lib_sandbox/src/runtime/lua.rs");
    for (const ns of ["events", "storage", "http", "env", "resources"]) {
      const inQ = quickjs.includes(`build_${ns}_namespace`) || quickjs.includes(`"${ns}"`);
      const inL = lua.includes(`build_${ns}_namespace`) || lua.includes(`"${ns}"`);
      if (!inQ || !inL) {
        throw new Error(
          `runtime asymmetry — ns=${ns}: quickjs=${inQ}, lua=${inL}. The two adapters should expose the same surface.`,
        );
      }
    }
  });
});
