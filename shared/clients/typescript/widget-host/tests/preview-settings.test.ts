import { describe, expect, it } from "bun:test";
import type { ConfigField, ConfigFieldType } from "@woofx3/api/ui-schema";
import { PreviewStorage } from "../preview/page/preview-storage";
import {
  type ControlKind,
  controlKind,
  controlText,
  defaultSettings,
  readControl,
} from "../preview/page/settings-form";

function field(type: ConfigFieldType, extra: Partial<ConfigField> = {}): ConfigField {
  return { id: `${type}Field`, label: type, type, ...extra };
}

describe("controlKind", () => {
  it.each([
    ["number", "number"],
    ["range", "range"],
    ["text", "text"],
    ["toggle", "toggle"],
    ["color", "color"],
    ["font", "text"],
    ["media", "json"],
    ["asset", "json"],
    ["resource_ref", "json"],
    ["layout", "json"],
    ["list", "json"],
    ["button", null],
    ["theme", null],
  ] as Array<[ConfigFieldType, ControlKind | null]>)("edits a %s field with %p", (type, kind) => {
    expect(controlKind(field(type))).toBe(kind);
  });

  it("edits a select with options as a select, and one filled from a source as text", () => {
    expect(controlKind(field("select", { options: [{ value: "a", label: "A" }] }))).toBe("select");
    expect(controlKind(field("select", { source: { kind: "scenes" } as ConfigField["source"] }))).toBe("text");
  });
});

describe("defaultSettings", () => {
  it("starts every field that declares a default there, and leaves the rest unset", () => {
    const list = [{ name: "a" }];
    const settings = defaultSettings([
      field("number", { defaultValue: 5 }),
      field("text"),
      field("list", { defaultValue: list }),
      field("button", { defaultValue: "ignored" }),
    ]);
    expect(settings).toEqual({ numberField: 5, listField: [{ name: "a" }] });
    expect(settings.listField).not.toBe(list);
  });
});

describe("readControl", () => {
  it.each([
    ["number", "12.5", { ok: true, value: 12.5 }],
    ["number", "", { ok: true, value: undefined }],
    ["number", "twelve", { ok: false, error: "twelve is not a number" }],
    ["range", "3", { ok: true, value: 3 }],
    ["text", "", { ok: true, value: "" }],
    ["text", " hi ", { ok: true, value: " hi " }],
    ["color", "", { ok: true, value: undefined }],
    ["color", "rgba(0, 0, 0, 0.5)", { ok: true, value: "rgba(0, 0, 0, 0.5)" }],
    ["select", "", { ok: true, value: undefined }],
    ["toggle", true, { ok: true, value: true }],
    ["toggle", false, { ok: true, value: false }],
    ["json", '{"url":"https://x.test/a.png"}', { ok: true, value: { url: "https://x.test/a.png" } }],
    ["json", " ", { ok: true, value: undefined }],
  ] as Array<[ControlKind, string | boolean, unknown]>)("reads %s %j as %j", (kind, raw, expected) => {
    expect(readControl(kind, raw)).toEqual(expected as ReturnType<typeof readControl>);
  });

  it("says why text is no JSON", () => {
    const read = readControl("json", "{ nope");
    expect(read.ok).toBe(false);
  });

  it("shows a value as the text it reads back as", () => {
    for (const [kind, value] of [
      ["number", 4],
      ["text", "hi"],
      ["json", [{ a: 1 }]],
    ] as Array<[ControlKind, unknown]>) {
      expect(readControl(kind, controlText(kind, value))).toEqual({ ok: true, value });
    }
    expect(controlText("number", undefined)).toBe("");
  });
});

describe("PreviewStorage", () => {
  function target() {
    const sent: Array<[string, unknown]> = [];
    return { sent, sendStorageValue: (key: string, value: unknown) => sent.push([key, value]) };
  }

  it("reads null for a key until a frame watches it, as the overlay's module state does", () => {
    const storage = new PreviewStorage();
    storage.set("count", 1);
    const frame = target();
    const access = storage.access(frame);
    expect(access.get("count")).toBeNull();
    access.subscribe("count");
    expect(access.get("count")).toBe(1);
    expect(frame.sent).toEqual([["count", 1]]);
  });

  it("sends a watched key's changes until its last watch ends", () => {
    const storage = new PreviewStorage();
    const frame = target();
    const access = storage.access(frame);
    access.subscribe("count");
    access.subscribe("count");
    storage.set("count", 2);
    access.unsubscribe("count");
    storage.set("count", 3);
    access.unsubscribe("count");
    storage.set("count", 4);
    storage.delete("count");
    expect(frame.sent).toEqual([
      ["count", null],
      ["count", null],
      ["count", 2],
      ["count", 3],
    ]);
    expect(storage.entries()).toEqual([]);
  });

  it("forgets every watch of a frame that leaves", () => {
    const storage = new PreviewStorage();
    const frame = target();
    const access = storage.access(frame);
    access.subscribe("a");
    access.subscribe("b");
    storage.unwatchAll(frame);
    storage.set("a", 1);
    storage.set("b", 1);
    expect(frame.sent).toEqual([
      ["a", null],
      ["b", null],
    ]);
  });
});
