import { describe, expect, it } from "bun:test";
import { obsAddressOf, obsStatusReply } from "../../src/obs/status";

describe("obsStatusReply", () => {
  it("reports the state, the last failure and where OBS was looked for", () => {
    const reply = obsStatusReply(
      { status: () => "retrying", lastFailure: () => "authentication" },
      "ws://192.168.1.20:4455"
    );
    expect(reply).toEqual({ state: "retrying", failure: "authentication", address: "192.168.1.20:4455" });
  });

  it("has no address before any attempt", () => {
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
});
