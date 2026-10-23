import { describe, expect, it } from "bun:test";
import {
  OBS_BROWSER_SOURCE_REFRESH_SUBJECT,
  parseObsBrowserSourceRefresh,
  parseObsBrowserSourceRefreshReply,
} from "./commands";

describe("OBS_BROWSER_SOURCE_REFRESH_SUBJECT", () => {
  it("sits under the reserved engine. prefix", () => {
    expect(OBS_BROWSER_SOURCE_REFRESH_SUBJECT).toBe("engine.obs.browser_source.refresh");
  });
});

describe("parseObsBrowserSourceRefresh", () => {
  const cases: [string, unknown, boolean][] = [
    ["a valid request", { overlayPort: 9101, bootId: "abc" }, true],
    ["the lowest port", { overlayPort: 1, bootId: "a" }, true],
    ["the highest port", { overlayPort: 65535, bootId: "a".repeat(64) }, true],
    ["port 0", { overlayPort: 0, bootId: "abc" }, false],
    ["a port above 65535", { overlayPort: 65536, bootId: "abc" }, false],
    ["a fractional port", { overlayPort: 80.5, bootId: "abc" }, false],
    ["a port sent as text", { overlayPort: "9101", bootId: "abc" }, false],
    ["no port", { bootId: "abc" }, false],
    ["an empty bootId", { overlayPort: 9101, bootId: "" }, false],
    ["a bootId over 64 characters", { overlayPort: 9101, bootId: "a".repeat(65) }, false],
    ["a numeric bootId", { overlayPort: 9101, bootId: 7 }, false],
    ["null", null, false],
    ["an array", [], false],
  ];
  for (const [name, input, ok] of cases) {
    it(`${ok ? "accepts" : "refuses"} ${name}`, () => {
      expect(parseObsBrowserSourceRefresh(input).ok).toBe(ok);
    });
  }
});

describe("parseObsBrowserSourceRefreshReply", () => {
  const cases: [string, unknown, boolean][] = [
    ["accepted", { status: "accepted", bootId: "abc" }, true],
    ["invalid", { status: "invalid", error: "bad" }, true],
    ["accepted without a bootId", { status: "accepted" }, false],
    ["accepted with an over-long bootId", { status: "accepted", bootId: "a".repeat(65) }, false],
    ["invalid without an error", { status: "invalid" }, false],
    ["unavailable", { status: "unavailable", error: "busy" }, true],
    ["unavailable without an error", { status: "unavailable" }, false],
    ["an unknown status", { status: "later" }, false],
    ["a non-object", "accepted", false],
  ];
  for (const [name, input, ok] of cases) {
    it(`${ok ? "accepts" : "refuses"} ${name}`, () => {
      expect(parseObsBrowserSourceRefreshReply(input).ok).toBe(ok);
    });
  }
});
