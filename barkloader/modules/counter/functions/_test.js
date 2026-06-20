// Quick smoke tests for counter functions.
// Run with:  bun barkloader/modules/counter/functions/_test.js
// (from the repo root)

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function load(name) {
  const src = readFileSync(join(__dirname, name), "utf8");
  // Each file defines a single named function. We eval and return it.
  const fn = eval(src + `; ${name.replace(".js", "")}`);
  return fn;
}

function makeCtx(params, storedValue) {
  const target = typeof params.target === "string" ? params.target : "";
  const store = {};
  if (typeof storedValue === "number" && target) {
    store["state:" + target] = storedValue;
  }
  const sets = [];
  return {
    ctx: {
      event: { parameters: params },
      storage: {
        get(key) { return key in store ? store[key] : null; },
        set(key, val) { store[key] = val; sets.push({ key, val }); },
      },
    },
    sets,
    store,
  };
}

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error("  FAIL:", msg);
    failed++;
  } else {
    console.log("  pass:", msg);
    passed++;
  }
}

function runTests(label, fn) {
  console.log("\n" + label);
  fn();
}

// --- set ---

const setFn = load("set.js");

runTests("set()", () => {
  {
    const { ctx, store } = makeCtx({ target: "counter:counter:x", value: 42 }, 10);
    const r = setFn(ctx);
    assert(r.previous === 10,                          "returns previous value");
    assert(r.next === 42,                              "returns new value");
    assert(store["state:counter:counter:x"] === 42,   "writes to storage");
  }
  {
    const { ctx } = makeCtx({ target: "counter:counter:x", value: 0 }, 7);
    const r = setFn(ctx);
    assert(r.next === 0, "can set to 0");
  }
  {
    const { ctx } = makeCtx({ value: 5 });
    try { setFn(ctx); assert(false, "should throw"); } catch(e) { assert(e.message.includes("target"), "throws on missing target"); }
  }
  {
    const { ctx } = makeCtx({ target: "counter:counter:x", value: "notanumber" });
    try { setFn(ctx); assert(false, "should throw"); } catch(e) { assert(e.message.includes("value"), "throws on non-numeric value"); }
  }
});

// --- reset ---

const resetFn = load("reset.js");

runTests("reset()", () => {
  {
    const { ctx, store } = makeCtx({ target: "counter:counter:x" }, 50);
    const r = resetFn(ctx);
    assert(r.previous === 50,                         "returns previous value");
    assert(r.next === 0,                              "defaults to 0");
    assert(store["state:counter:counter:x"] === 0,   "writes 0 to storage");
  }
  {
    const { ctx, store } = makeCtx({ target: "counter:counter:x", initialValue: 20 }, 0);
    const r = resetFn(ctx);
    assert(r.next === 20,                             "uses provided initialValue");
    assert(store["state:counter:counter:x"] === 20,  "writes initialValue to storage");
  }
  {
    const { ctx } = makeCtx({});
    try { resetFn(ctx); assert(false, "should throw"); } catch(e) { assert(e.message.includes("target"), "throws on missing target"); }
  }
  {
    const { ctx, store } = makeCtx({ target: "counter:counter:x", initialValue: "bad" }, 3);
    const r = resetFn(ctx);
    assert(r.next === 0, "falls back to 0 for non-numeric initialValue");
  }
});

// --- renderLabel (isolated logic test) ---

function renderLabel(value, settings) {
  const n = Number.isFinite(Number(value)) ? Number(value) : 0;
  const max = Number.isFinite(Number(settings.maxValue)) ? Number(settings.maxValue) : null;
  let tmpl = typeof settings.labelTemplate === "string" && settings.labelTemplate.trim()
    ? settings.labelTemplate : "{value}";
  tmpl = tmpl.replace(/\{value\}/g, String(n));
  if (max !== null) {
    tmpl = tmpl.replace(/\{max\}/g, String(max));
  }
  return tmpl;
}

runTests("renderLabel()", () => {
  assert(renderLabel(5,    { labelTemplate: "{value} deaths so far" })              === "5 deaths so far",          "plain suffix");
  assert(renderLabel(6,    { labelTemplate: "Streamer has died {value} times" })    === "Streamer has died 6 times", "prefix");
  assert(renderLabel(14,   { labelTemplate: "{value}/{max} subs", maxValue: 25 })   === "14/25 subs",               "value/max format");
  assert(renderLabel(1500, { labelTemplate: "{value}/{max} bits", maxValue: 5000 }) === "1500/5000 bits",            "bits");
  assert(renderLabel(12,   { labelTemplate: "{value}/{max} pushups remaining", maxValue: 20 }) === "12/20 pushups remaining", "pushups");
  assert(renderLabel(null, { labelTemplate: "{value}" })                            === "0",                         "null value renders 0");
  assert(renderLabel(3,    {})                                                      === "3",                         "no template defaults to {value}");
  assert(renderLabel(7,    { labelTemplate: "{value} / {max} goal", maxValue: 10 }) === "7 / 10 goal",              "spaces around /");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) { process.exit(1); }
