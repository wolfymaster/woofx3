import { describe, expect, it } from "bun:test";
import {
  assetOfReadPath,
  assetReadPath,
  createMockHost,
  engineAssetPath,
  parseEngineAssetPath,
  widgetMayRead,
} from "../src/index";

describe("parseEngineAssetPath", () => {
  it("reads a library file and a module's file", () => {
    expect(parseEngineAssetPath("/assets/user/res-1/anim.json")).toEqual({
      area: "user",
      owner: "res-1",
      path: "/assets/user/res-1/anim.json",
    });
    expect(parseEngineAssetPath("/assets/modules/woofx3/v1/data.json")?.owner).toBe("woofx3");
  });

  it("refuses paths that are not an engine file", () => {
    for (const path of [
      "/assets/user/res-1",
      "/assets/user/",
      "/assets/fonts/inter.woff2",
      "/api/assets/user/res-1/a.json",
      "assets/user/res-1/a.json",
      "/assets/user/res-1/",
    ]) {
      expect(parseEngineAssetPath(path)).toBeNull();
    }
  });

  it("refuses a dot segment or separator, encoded or not, so nothing steps out of its owner", () => {
    for (const path of [
      "/assets/modules/woofx3/../other/secret.json",
      "/assets/modules/woofx3/%2e%2e/other/secret.json",
      "/assets/modules/woofx3%2F..%2Fother/secret.json",
      "/assets/user/res-1/a%5Cb.json",
      "/assets/user/res-1/%E0%A4%A.json",
    ]) {
      expect(parseEngineAssetPath(path)).toBeNull();
    }
  });
});

describe("widgetMayRead", () => {
  it("allows any library file and the widget's own module's files, nothing else", () => {
    expect(widgetMayRead(parseEngineAssetPath("/assets/user/res-1/a.json")!, "woofx3")).toBe(true);
    expect(widgetMayRead(parseEngineAssetPath("/assets/modules/woofx3/v1/a.json")!, "woofx3")).toBe(true);
    expect(widgetMayRead(parseEngineAssetPath("/assets/modules/other/v1/a.json")!, "woofx3")).toBe(false);
    expect(widgetMayRead(parseEngineAssetPath("/assets/user/res-1/a.json")!, "")).toBe(false);
  });
});

describe("the read route's path", () => {
  it("round-trips an engine file", () => {
    const asset = parseEngineAssetPath("/assets/user/res-1/anim.json")!;
    expect(assetReadPath(asset)).toBe("/assets/read/user/res-1/anim.json");
    expect(assetOfReadPath(assetReadPath(asset))).toEqual(asset);
    expect(assetOfReadPath("/assets/read/fonts/x.woff2")).toBeNull();
    expect(assetOfReadPath("/assets/user/res-1/anim.json")).toBeNull();
  });
});

describe("engineAssetPath", () => {
  it("keeps only the path of an engine file, on any origin", () => {
    expect(engineAssetPath("https://elsewhere.test/assets/user/res-1/a.json", "https://e.test/")).toBe(
      "/assets/user/res-1/a.json"
    );
    expect(engineAssetPath("data/a.json", "https://e.test/assets/modules/woofx3/v1/")).toBe(
      "/assets/modules/woofx3/v1/data/a.json"
    );
    expect(engineAssetPath("https://cdn.example.org/a.json", "https://e.test/")).toBeNull();
  });
});

describe("the preview host judges references as a real frame does", () => {
  const host = () =>
    createMockHost({
      moduleId: "woofx3",
      resourceBaseUrl: "https://preview.local/resources",
      assets: {
        "anim.json": "{}",
        "https://e.test/assets/user/res-1/a.json": "{}",
        "https://e.test/assets/modules/other/v1/a.json": "{}",
        "https://cdn.example.org/a.json": "{}",
      },
    }).host;

  it("reads the widget's own files and library files", async () => {
    expect((await host().assets.load("anim.json")).path).toBe("/resources/anim.json");
    expect((await host().assets.load("https://e.test/assets/user/res-1/a.json")).path).toBe(
      "/assets/user/res-1/a.json"
    );
  });

  it("refuses another module's files and files hosted elsewhere, even when given", async () => {
    await expect(host().assets.load("https://e.test/assets/modules/other/v1/a.json")).rejects.toMatchObject({
      code: "out_of_scope",
    });
    await expect(host().assets.load("https://cdn.example.org/a.json")).rejects.toMatchObject({
      code: "not_engine_asset",
    });
  });

  it("rejects an empty reference rather than throwing", async () => {
    const pending = host().assets.load("");
    await expect(pending).rejects.toMatchObject({ code: "not_engine_asset" });
  });
});
