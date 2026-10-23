import { describe, expect, it } from "bun:test";
import { declaredEndpoint, isLocalEndpointRef } from "./endpoints";

const REF = { moduleId: "woofx3_obs", endpointId: "obs" };
const ENTRY = {
  id: "obs",
  name: "OBS Studio",
  protocol: "websocket",
  hostSetting: "obsHost",
  portSetting: "obsPort",
  passwordSetting: "obsPassword",
  discover: { known: "obs" },
};
const manifest = (local: unknown) => JSON.stringify({ id: "woofx3_obs", local });

describe("declaredEndpoint", () => {
  it("returns the whole local[] entry", () => {
    expect(declaredEndpoint(manifest([ENTRY]), REF)).toEqual({
      id: "obs",
      name: "OBS Studio",
      protocol: "websocket",
      hostSetting: "obsHost",
      portSetting: "obsPort",
      passwordSetting: "obsPassword",
    });
  });

  it("leaves out a password setting the entry does not name", () => {
    const { passwordSetting: _, ...withoutPassword } = ENTRY;
    expect(declaredEndpoint(manifest([withoutPassword]), REF)).not.toHaveProperty("passwordSetting");
  });

  const absent: Array<[string, string | null, { moduleId: string; endpointId: string }]> = [
    ["no manifest", null, REF],
    ["an empty manifest", "", REF],
    ["a manifest that is not JSON", "{", REF],
    ["no local[]", JSON.stringify({ id: "woofx3_obs" }), REF],
    ["a local that is not a list", manifest({}), REF],
    ["another endpoint only", manifest([{ ...ENTRY, id: "other" }]), REF],
    ["a host setting that is not text", manifest([{ ...ENTRY, hostSetting: 1 }]), REF],
    ["no name", manifest([{ ...ENTRY, name: undefined }]), REF],
    ["an unknown protocol", manifest([{ ...ENTRY, protocol: "udp" }]), REF],
    ["a module id the relay refuses", manifest([ENTRY]), { moduleId: "..", endpointId: "obs" }],
    [
      "an endpoint id the relay refuses",
      manifest([{ ...ENTRY, id: "OBS" }]),
      { moduleId: "woofx3_obs", endpointId: "OBS" },
    ],
  ];
  for (const [name, stored, ref] of absent) {
    it(`reads ${name} as declaring nothing`, () => {
      expect(declaredEndpoint(stored, ref)).toBeNull();
    });
  }
});

describe("isLocalEndpointRef", () => {
  const cases: Array<[unknown, boolean]> = [
    [REF, true],
    [{ moduleId: "a.b-c_1", endpointId: "x-1_y" }, true],
    [{ moduleId: ".", endpointId: "obs" }, false],
    [{ moduleId: "", endpointId: "obs" }, false],
    [{ moduleId: "woofx3_obs", endpointId: "Obs" }, false],
    [{ moduleId: "woofx3/obs", endpointId: "obs" }, false],
    [{ moduleId: "woofx3_obs" }, false],
    [null, false],
    ["woofx3_obs/obs", false],
  ];
  for (const [value, expected] of cases) {
    it(`${JSON.stringify(value)} -> ${expected}`, () => {
      expect(isLocalEndpointRef(value)).toBe(expected);
    });
  }
});
