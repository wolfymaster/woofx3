import { describe, expect, it } from "bun:test";
import { ObsRouteUnavailable, obsFailureKind } from "./connection";
import { OBS_FALLBACK_KEYS, obsAdapterFallback } from "./settings";

describe("obsAdapterFallback", () => {
  it("hands connectors' configuration to the companion gateway, with the pre-local[] setting ids", () => {
    expect(obsAdapterFallback({ host: "127.0.0.1", port: "4455", token: "from-config" })).toEqual({
      keys: OBS_FALLBACK_KEYS,
      host: "127.0.0.1",
      port: "4455",
      password: "from-config",
    });
    expect(obsAdapterFallback({ host: "obs.lan", port: "4455" })).not.toHaveProperty("password");
  });
});

describe("ObsRouteUnavailable", () => {
  const cases: Array<[ConstructorParameters<typeof ObsRouteUnavailable>[0], "relay" | "unreachable"]> = [
    ["relay", "relay"],
    ["busy", "relay"],
    ["store_unreadable", "unreachable"],
    ["not_routed", "unreachable"],
    ["not_declared", "unreachable"],
    ["protocol_unsupported", "unreachable"],
  ];
  for (const [reason, kind] of cases) {
    it(`reads the companion gateway's ${reason} as ${kind}`, () => {
      expect(obsFailureKind(new ObsRouteUnavailable(reason, "no route"))).toBe(kind);
    });
  }
});
