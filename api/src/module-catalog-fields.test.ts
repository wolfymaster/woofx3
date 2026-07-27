import { describe, expect, test } from "bun:test";
import { readModuleCatalogFields } from "./api";

describe("readModuleCatalogFields", () => {
  test("returns author and taxonomy from a well-formed manifest", () => {
    const manifest = JSON.stringify({
      id: "wolfy_profile",
      name: "Wolfy profile",
      author: "WolfyMaster LLC",
      taxonomy: ["platform.govee", "function.lighting"],
    });
    expect(readModuleCatalogFields(manifest)).toEqual({
      author: "WolfyMaster LLC",
      taxonomy: ["platform.govee", "function.lighting"],
    });
  });

  test("falls back to legacy category when taxonomy is absent", () => {
    const manifest = JSON.stringify({
      id: "wolfy_profile",
      name: "Wolfy profile",
      author: "WolfyMaster LLC",
      category: "platform",
    });
    expect(readModuleCatalogFields(manifest)).toEqual({
      author: "WolfyMaster LLC",
      taxonomy: ["platform"],
    });
  });

  test("prefers taxonomy over legacy category when both are present", () => {
    const manifest = JSON.stringify({
      category: "platform",
      taxonomy: ["platform.spotify"],
    });
    expect(readModuleCatalogFields(manifest)).toEqual({
      author: "Unknown",
      taxonomy: ["platform.spotify"],
    });
  });

  test("defaults author to 'Unknown' and taxonomy to empty when the manifest omits them", () => {
    const manifest = JSON.stringify({ id: "m", name: "M" });
    expect(readModuleCatalogFields(manifest)).toEqual({
      author: "Unknown",
      taxonomy: [],
    });
  });

  test("treats blank / whitespace-only values as missing", () => {
    const manifest = JSON.stringify({ author: "  ", category: "" });
    expect(readModuleCatalogFields(manifest)).toEqual({
      author: "Unknown",
      taxonomy: [],
    });
  });

  test("trims surrounding whitespace from real values", () => {
    const manifest = JSON.stringify({
      author: "  WolfyMaster LLC  ",
      category: " platform ",
    });
    expect(readModuleCatalogFields(manifest)).toEqual({
      author: "WolfyMaster LLC",
      taxonomy: ["platform"],
    });
  });

  test("falls back to defaults when the stored manifest is empty or malformed", () => {
    expect(readModuleCatalogFields(undefined)).toEqual({
      author: "Unknown",
      taxonomy: [],
    });
    expect(readModuleCatalogFields("")).toEqual({
      author: "Unknown",
      taxonomy: [],
    });
    expect(readModuleCatalogFields("not-json")).toEqual({
      author: "Unknown",
      taxonomy: [],
    });
  });

  test("ignores non-string author / category values", () => {
    const manifest = JSON.stringify({ author: 42, category: { name: "x" } });
    expect(readModuleCatalogFields(manifest)).toEqual({
      author: "Unknown",
      taxonomy: [],
    });
  });

  test("filters non-string entries out of a taxonomy array", () => {
    const manifest = JSON.stringify({ taxonomy: ["platform.twitch", 42, null] });
    expect(readModuleCatalogFields(manifest)).toEqual({
      author: "Unknown",
      taxonomy: ["platform.twitch"],
    });
  });
});
