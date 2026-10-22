import { describe, expect, it } from "bun:test";
import { obsAddressOf, obsStatusReply } from "../../src/obs/status";

describe("obsStatusReply", () => {
  it("reports the state, the last failure, and where and how OBS was looked for", () => {
    const reply = obsStatusReply(
      { status: () => "retrying", lastFailure: () => "authentication" },
      { route: "direct", address: "192.168.1.20:4455" }
    );
    expect(reply).toEqual({
      state: "retrying",
      failure: "authentication",
      address: "192.168.1.20:4455",
      route: "direct",
    });
  });

  it("reports a relay failure on the companion route", () => {
    const reply = obsStatusReply(
      { status: () => "retrying", lastFailure: () => "relay" },
      { route: "companion", address: "c-abcdefghijkl.woofx3.tv" }
    );
    expect(reply).toEqual({
      state: "retrying",
      failure: "relay",
      address: "c-abcdefghijkl.woofx3.tv",
      route: "companion",
    });
  });

  it("has no address or route before any attempt", () => {
    expect(obsStatusReply({ status: () => "connecting", lastFailure: () => null }, null)).toEqual({
      state: "connecting",
      failure: null,
      address: null,
    });
  });
});

describe("obsAddressOf", () => {
  it("keeps only host and port", () => {
    expect(obsAddressOf("ws://[::1]:4455")).toBe("[::1]:4455");
    expect(obsAddressOf("wss://obs.lan:4455/")).toBe("obs.lan:4455");
  });

  it("never keeps a bridge path or ticket", () => {
    expect(obsAddressOf("wss://c-abcdefghijkl.woofx3.tv/bridge/woofx3_obs/obs?ticket=secret")).toBe(
      "c-abcdefghijkl.woofx3.tv"
    );
  });
});
