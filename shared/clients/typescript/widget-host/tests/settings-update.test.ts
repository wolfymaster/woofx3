import { describe, expect, it } from "bun:test";
import { settingsUpdate } from "../page/settings-update";

describe("settingsUpdate", () => {
  const reads = (keys: string[], all = false) => ({ all, keys: new Set(keys) });

  it("does nothing when no setting changed, whatever the key order", () => {
    expect(settingsUpdate({ a: 1, b: { x: 1, y: 2 } }, { b: { y: 2, x: 1 }, a: 1 }, null)).toBe("none");
  });

  it("patches a change to settings the widget's script never read", () => {
    expect(settingsUpdate({ color: "#fff", text: "hi" }, { color: "#000", text: "hi" }, reads(["duration"]))).toBe(
      "patch"
    );
  });

  it("reloads for a change to a setting the script read", () => {
    expect(settingsUpdate({ duration: 5 }, { duration: 8 }, reads(["duration"]))).toBe("reload");
  });

  it("reloads when the script read everything, or nothing is known yet", () => {
    expect(settingsUpdate({ a: 1 }, { a: 2 }, reads([], true))).toBe("reload");
    expect(settingsUpdate({ a: 1 }, { a: 2 }, null)).toBe("reload");
  });

  it("counts a setting added or removed as changed", () => {
    expect(settingsUpdate({ a: 1 }, { a: 1, b: 2 }, reads(["b"]))).toBe("reload");
    expect(settingsUpdate({ a: 1, b: 2 }, { a: 1 }, reads([]))).toBe("patch");
  });
});
