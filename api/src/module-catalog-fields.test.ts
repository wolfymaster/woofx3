import { describe, expect, test } from "bun:test";
import { readModuleCatalogFields } from "./api";

describe("readModuleCatalogFields", () => {
  test("returns author and category from a well-formed manifest", () => {
    const manifest = JSON.stringify({
      id: "wolfy_profile",
      name: "Wolfy profile",
      author: "WolfyMaster LLC",
      category: "platform",
    });
    expect(readModuleCatalogFields(manifest)).toEqual({
      author: "WolfyMaster LLC",
      category: "platform",
    });
  });

  test("defaults both fields to 'Unknown' when the manifest omits them", () => {
    const manifest = JSON.stringify({ id: "m", name: "M" });
    expect(readModuleCatalogFields(manifest)).toEqual({
      author: "Unknown",
      category: "Unknown",
    });
  });

  test("treats blank / whitespace-only values as missing", () => {
    const manifest = JSON.stringify({ author: "  ", category: "" });
    expect(readModuleCatalogFields(manifest)).toEqual({
      author: "Unknown",
      category: "Unknown",
    });
  });

  test("trims surrounding whitespace from real values", () => {
    const manifest = JSON.stringify({
      author: "  WolfyMaster LLC  ",
      category: " platform ",
    });
    expect(readModuleCatalogFields(manifest)).toEqual({
      author: "WolfyMaster LLC",
      category: "platform",
    });
  });

  test("falls back to 'Unknown' when the stored manifest is empty or malformed", () => {
    expect(readModuleCatalogFields(undefined)).toEqual({
      author: "Unknown",
      category: "Unknown",
    });
    expect(readModuleCatalogFields("")).toEqual({
      author: "Unknown",
      category: "Unknown",
    });
    expect(readModuleCatalogFields("not-json")).toEqual({
      author: "Unknown",
      category: "Unknown",
    });
  });

  test("ignores non-string author / category values", () => {
    const manifest = JSON.stringify({ author: 42, category: { name: "x" } });
    expect(readModuleCatalogFields(manifest)).toEqual({
      author: "Unknown",
      category: "Unknown",
    });
  });
});
