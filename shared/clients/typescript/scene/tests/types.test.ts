import { describe, expect, test } from "bun:test";
import { ANCHOR_KINDS, PROFILES } from "../model";

describe("profiles", () => {
  test("only an alert may anchor to its start or end", () => {
    expect(PROFILES.alert.anchors).toEqual(ANCHOR_KINDS);
    expect(PROFILES.scene.anchors).not.toContain("start");
    expect(PROFILES.scene.anchors).not.toContain("end");
  });
});
