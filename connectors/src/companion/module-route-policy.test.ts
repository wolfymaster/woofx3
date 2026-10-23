import { describe, expect, it } from "bun:test";
import type { EngineHosting } from "@woofx3/api";
import { OBS_ENDPOINT } from "../adapters/obs/settings";
import { emptyEndpointStore } from "../host/testing";
import { ClaimRegistry } from "./claims";
import type { EndpointStore, StoredModuleSetting } from "./endpoint-store";
import type { NameResolver } from "./local-address";
import { type ModulePolicyDeps, modulePolicy } from "./module-route-policy";
import type { LocalEndpointRef } from "./types";

const VTS: LocalEndpointRef = { moduleId: "vtube_studio", endpointId: "vts" };

function manifest(protocol = "websocket", moduleId = VTS.moduleId): string {
  return JSON.stringify({
    id: moduleId,
    local: [
      {
        id: "vts",
        name: "VTube Studio",
        protocol,
        hostSetting: "vtsHost",
        portSetting: "vtsPort",
        passwordSetting: "vtsToken",
      },
      {
        id: "obs",
        name: "OBS Studio",
        protocol: "websocket",
        hostSetting: "obsHost",
        portSetting: "obsPort",
      },
    ],
  });
}

const settingsAt = (host: string, port = "8001"): StoredModuleSetting[] => [
  { key: "vtsHost", value: host },
  { key: "vtsPort", value: port },
];

const unreadable = async (): Promise<never> => {
  throw new Error("db-proxy: unavailable");
};

const noResolver: NameResolver = async (name) => {
  throw new Error(`no resolution for ${name}`);
};

function policy(overrides: Partial<Omit<ModulePolicyDeps, "store">> & { store?: Partial<EndpointStore> } = {}) {
  const { store, ...rest } = overrides;
  return modulePolicy({
    store: {
      ...emptyEndpointStore,
      moduleManifest: async (id) => manifest("websocket", id),
      moduleSettings: async () => settingsAt("127.0.0.1"),
      moduleSecrets: async () => ({ vtsToken: "never-read" }),
      ...store,
    },
    claims: ClaimRegistry.fromManifests([{ id: "obs", localEndpoints: [OBS_ENDPOINT] }]),
    hosting: "local",
    localDirect: false,
    resolver: noResolver,
    ...rest,
  });
}

describe("modulePolicy refusals", () => {
  it("refuses an endpoint a host adapter claims before reading anything", async () => {
    let read = false;
    const claimed = policy({
      store: {
        moduleManifest: async () => {
          read = true;
          return manifest("websocket", OBS_ENDPOINT.moduleId);
        },
      },
    });
    expect(await claimed.direct(OBS_ENDPOINT, undefined)).toEqual({
      ok: false,
      reason: "adapter_owned",
      message: "woofx3_obs/obs is reached through the obs adapter; module code cannot open it",
    });
    expect(read).toBe(false);
  });

  it("refuses an endpoint the installed manifest does not declare", async () => {
    expect(await policy().direct({ moduleId: VTS.moduleId, endpointId: "lights" }, undefined)).toMatchObject({
      ok: false,
      reason: "not_declared",
    });
    const uninstalled = policy({ store: { moduleManifest: async () => null } });
    expect(await uninstalled.direct(VTS, undefined)).toMatchObject({ ok: false, reason: "not_declared" });
  });

  it("refuses an http endpoint", async () => {
    const http = policy({ store: { moduleManifest: async () => manifest("http") } });
    expect(await http.direct(VTS, undefined)).toEqual({
      ok: false,
      reason: "protocol_unsupported",
      message: "http endpoints are not supported yet",
    });
  });

  it("answers store_unreadable, never a fallback, when the manifest or the settings cannot be read", async () => {
    expect(await policy({ store: { moduleManifest: unreadable } }).direct(VTS, undefined)).toMatchObject({
      ok: false,
      reason: "store_unreadable",
    });
    expect(await policy({ store: { moduleSettings: unreadable } }).direct(VTS, undefined)).toMatchObject({
      ok: false,
      reason: "store_unreadable",
    });
  });

  it("admits a declared, unclaimed websocket endpoint whatever the hosting", async () => {
    expect(await policy({ hosting: "managed" }).admit(VTS)).toMatchObject({ ok: true, endpoint: { id: "vts" } });
  });

  it("fails closed when the relay configuration cannot be read", () => {
    expect(policy().directWithoutRelayConfig).toBe(false);
  });
});

describe("modulePolicy direct routes by hosting", () => {
  type Row = { hosting: EngineHosting | null; localDirect: boolean; route: "direct" | "not_routed" };
  const rows: Row[] = [
    { hosting: "local", localDirect: false, route: "direct" },
    { hosting: "self", localDirect: false, route: "not_routed" },
    { hosting: "self", localDirect: true, route: "direct" },
    { hosting: "managed", localDirect: false, route: "not_routed" },
    { hosting: "managed", localDirect: true, route: "not_routed" },
    { hosting: null, localDirect: false, route: "not_routed" },
    { hosting: null, localDirect: true, route: "not_routed" },
  ];
  for (const { hosting, localDirect, route } of rows) {
    it(`hosting ${hosting ?? "unset"}, WOOFX3_MODULE_LOCAL_DIRECT=${localDirect}: ${route}`, async () => {
      const decision = await policy({
        hosting,
        localDirect,
        store: { moduleSettings: async () => settingsAt("192.168.1.20") },
      }).direct(VTS, undefined);
      if (route === "direct") {
        expect(decision).toEqual({
          ok: true,
          route: "direct",
          url: "ws://192.168.1.20:8001",
          address: "192.168.1.20:8001",
        });
      } else {
        expect(decision).toMatchObject({ ok: false, reason: "not_routed" });
      }
    });
  }

  it("tells a self-hosted operator which switch turns direct dials on", async () => {
    expect(await policy({ hosting: "self" }).direct(VTS, undefined)).toMatchObject({
      message: expect.stringContaining("WOOFX3_MODULE_LOCAL_DIRECT=true"),
    });
  });
});

describe("modulePolicy addresses", () => {
  it("never carries the password setting", async () => {
    const decision = await policy().direct(VTS, undefined);
    expect(decision).toEqual({ ok: true, route: "direct", url: "ws://127.0.0.1:8001", address: "127.0.0.1:8001" });
  });

  it("answers not_routed when the host or port setting is empty or not a port", async () => {
    for (const settings of [settingsAt(""), settingsAt("127.0.0.1", ""), settingsAt("127.0.0.1", "70000"), []]) {
      const decision = await policy({ store: { moduleSettings: async () => settings } }).direct(VTS, undefined);
      expect(decision).toEqual({ ok: false, reason: "not_routed", message: "no address is set for this endpoint" });
    }
  });

  it("refuses cloud metadata on a self engine that allows direct dials", async () => {
    const metadata = policy({
      hosting: "self",
      localDirect: true,
      store: { moduleSettings: async () => settingsAt("169.254.169.254") },
    });
    expect(await metadata.direct(VTS, undefined)).toEqual({
      ok: false,
      reason: "address_refused",
      message: "169.254.169.254 is a cloud metadata address",
    });
  });

  it("dials the canonical IPv4 address of a hex or IPv4-mapped form", async () => {
    for (const host of ["0xc0a80114", "::ffff:192.168.1.20"]) {
      const decision = await policy({ store: { moduleSettings: async () => settingsAt(host) } }).direct(VTS, undefined);
      expect(decision).toMatchObject({ ok: true, url: "ws://192.168.1.20:8001" });
    }
  });

  it("brackets an IPv6 address in the url", async () => {
    const decision = await policy({ store: { moduleSettings: async () => settingsAt("fe80::1%eth0") } }).direct(
      VTS,
      undefined
    );
    expect(decision).toMatchObject({ ok: true, url: "ws://[fe80:0:0:0:0:0:0:1]:8001", address: "[fe80::1%eth0]:8001" });
  });

  it("refuses a .local name that resolves to a public address", async () => {
    const decision = await policy({
      resolver: async () => ["8.8.8.8"],
      store: { moduleSettings: async () => settingsAt("vts.local") },
    }).direct(VTS, undefined);
    expect(decision).toMatchObject({ ok: false, reason: "address_refused" });
  });

  it("dials the IP a .local name resolved to, and shows the name", async () => {
    const decision = await policy({
      resolver: async () => ["192.168.1.44"],
      store: { moduleSettings: async () => settingsAt("vts.local") },
    }).direct(VTS, undefined);
    expect(decision).toEqual({
      ok: true,
      route: "direct",
      url: "ws://192.168.1.44:8001",
      address: "vts.local:8001",
    });
  });
});
