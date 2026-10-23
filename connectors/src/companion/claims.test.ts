import { describe, expect, it } from "bun:test";
import type { AdapterManifest } from "../host/adapter";
import { ClaimRegistry, endpointKey, UnclaimedEndpointError } from "./claims";
import type { LocalEndpointRef } from "./types";

const OBS: LocalEndpointRef = { moduleId: "woofx3_obs", endpointId: "obs" };
const LIGHTS: LocalEndpointRef = { moduleId: "woofx3_lights", endpointId: "bridge" };

const manifest = (id: AdapterManifest["id"], localEndpoints?: readonly LocalEndpointRef[]) => ({ id, localEndpoints });

describe("ClaimRegistry", () => {
  it("knows each claim's owner from the manifests alone", () => {
    const claims = ClaimRegistry.fromManifests([manifest("twitch"), manifest("obs", [OBS])]);
    expect(claims.ownerOf(OBS)).toBe("obs");
    expect(claims.ownerOf(LIGHTS)).toBeNull();
    expect(claims.claims()).toEqual([{ ref: OBS, owner: "obs" }]);
  });

  it("stops startup on an endpoint two adapters claim", () => {
    expect(() => ClaimRegistry.fromManifests([manifest("obs", [OBS]), manifest("twitch", [OBS])])).toThrow(
      'the local endpoint woofx3_obs/obs is claimed by both "obs" and "twitch"'
    );
  });

  it("stops startup on an endpoint one adapter claims twice", () => {
    expect(() => ClaimRegistry.fromManifests([manifest("obs", [OBS, { ...OBS }])])).toThrow("claimed by both");
  });

  const malformed: Array<[string, unknown]> = [
    ["a module id the relay refuses", { moduleId: "..", endpointId: "obs" }],
    ["an upper-case endpoint id", { moduleId: "woofx3_obs", endpointId: "OBS" }],
    ["a missing endpoint id", { moduleId: "woofx3_obs" }],
    ["a string", "woofx3_obs/obs"],
  ];
  for (const [name, ref] of malformed) {
    it(`stops startup on ${name}`, () => {
      expect(() => ClaimRegistry.fromManifests([manifest("obs", [ref as LocalEndpointRef])])).toThrow(
        'the adapter "obs" claims a malformed local endpoint'
      );
    });
  }

  it("refuses an unclaimed ref, or one another adapter claims, naming the adapter and the ref", () => {
    const claims = ClaimRegistry.fromManifests([manifest("obs", [OBS])]);
    expect(() => claims.assertClaimedBy("obs", OBS)).not.toThrow();
    expect(() => claims.assertClaimedBy("obs", LIGHTS)).toThrow(UnclaimedEndpointError);
    expect(() => claims.assertClaimedBy("twitch", OBS)).toThrow(
      'the adapter "twitch" does not claim the local endpoint woofx3_obs/obs'
    );
  });

  it("keeps its own copy of each claimed ref", () => {
    const ref = { ...OBS };
    const claims = ClaimRegistry.fromManifests([manifest("obs", [ref])]);
    ref.endpointId = "changed";
    expect(claims.ownerOf(OBS)).toBe("obs");
  });
});

describe("endpointKey", () => {
  it("joins the ids with a slash, which neither id can hold", () => {
    expect(endpointKey(OBS)).toBe("woofx3_obs/obs");
  });
});
