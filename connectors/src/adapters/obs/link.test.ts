import { describe, expect, test } from "bun:test";
import type { InstalledModule, LinkStore } from "../../host/link-readers";
import { fixedLinkStore } from "../../host/testing";
import { MODULE_DELETED_SUBJECT, MODULE_INSTALLED_SUBJECT, obsLinkReader } from "./link";

function installed(moduleId: string, manifest: unknown, disabled = false): InstalledModule {
  return { moduleId, manifest: typeof manifest === "string" ? manifest : JSON.stringify(manifest), disabled };
}

const obsModule = (disabled = false) =>
  installed("woofx3_obs", { id: "woofx3_obs", permissions: ["obs.control"] }, disabled);
const otherModule = installed("alerts", { id: "alerts", permissions: ["storage"] });

describe("obsLinkReader", () => {
  const cases: Array<{
    name: string;
    hostExplicit: boolean;
    modules: InstalledModule[];
    connected: boolean;
    enabled: boolean;
    ignored: number;
  }> = [
    {
      name: "nothing installed, no host set",
      hostExplicit: false,
      modules: [],
      connected: false,
      enabled: false,
      ignored: 0,
    },
    {
      name: "only modules that do not control OBS",
      hostExplicit: false,
      modules: [otherModule, installed("bare", { id: "bare" })],
      connected: false,
      enabled: false,
      ignored: 0,
    },
    {
      name: "an active OBS module",
      hostExplicit: false,
      modules: [obsModule()],
      connected: true,
      enabled: true,
      ignored: 0,
    },
    {
      name: "a disabled OBS module",
      hostExplicit: false,
      modules: [obsModule(true)],
      connected: true,
      enabled: false,
      ignored: 0,
    },
    {
      name: "one disabled and one active module that control OBS",
      hostExplicit: false,
      modules: [obsModule(true), installed("scenes", { permissions: ["storage", "obs.control"] })],
      connected: true,
      enabled: true,
      ignored: 0,
    },
    {
      name: "the host set, nothing installed",
      hostExplicit: true,
      modules: [],
      connected: true,
      enabled: true,
      ignored: 0,
    },
    {
      name: "the host set and the OBS module disabled",
      hostExplicit: true,
      modules: [obsModule(true)],
      connected: true,
      enabled: true,
      ignored: 0,
    },
    {
      name: "a manifest that is not JSON",
      hostExplicit: false,
      modules: [installed("broken", "{not json"), obsModule()],
      connected: true,
      enabled: true,
      ignored: 1,
    },
    {
      name: "an empty stored manifest",
      hostExplicit: false,
      modules: [installed("empty", "")],
      connected: false,
      enabled: false,
      ignored: 1,
    },
    {
      name: "a manifest that is not an object",
      hostExplicit: false,
      modules: [installed("list", ["obs.control"])],
      connected: false,
      enabled: false,
      ignored: 1,
    },
    {
      name: "permissions that are not a list of strings",
      hostExplicit: false,
      modules: [
        installed("odd", { permissions: "obs.control" }),
        installed("mixed", { permissions: ["obs.control", 1] }),
      ],
      connected: false,
      enabled: false,
      ignored: 2,
    },
  ];
  for (const c of cases) {
    test(c.name, async () => {
      const reading = await obsLinkReader({ hostExplicit: c.hostExplicit }).read(fixedLinkStore({}, c.modules));
      expect({
        connected: reading.connected,
        enabled: reading.enabled,
        flag: reading.flag,
        ignored: reading.ignored.length,
      }).toEqual({ connected: c.connected, enabled: c.enabled, flag: null, ignored: c.ignored });
    });
  }

  test("names the module whose manifest it ignored", async () => {
    const reading = await obsLinkReader({ hostExplicit: false }).read(fixedLinkStore({}, [installed("broken", "{")]));
    expect(reading.ignored).toEqual([
      'module "broken": its stored manifest is not readable; it does not count as an OBS module',
    ]);
  });

  test("with the host set, reads nothing, so a db-proxy outage cannot stop OBS", async () => {
    const unreachable: LinkStore = {
      getSetting: async () => {
        throw new Error("db-proxy is down");
      },
      installedModules: async () => {
        throw new Error("db-proxy is down");
      },
    };
    expect((await obsLinkReader({ hostExplicit: true }).read(unreachable)).enabled).toBe(true);
  });

  test("a failed module read rejects rather than reading as uninstalled", async () => {
    const failing: LinkStore = {
      getSetting: async () => null,
      installedModules: async () => {
        throw new Error("db-proxy is down");
      },
    };
    await expect(obsLinkReader({ hostExplicit: false }).read(failing)).rejects.toThrow("db-proxy is down");
  });

  test("is read again on module installs and removals, and has no integration setting", () => {
    const reader = obsLinkReader({ hostExplicit: false });
    expect(reader.events).toEqual([MODULE_INSTALLED_SUBJECT, MODULE_DELETED_SUBJECT]);
    expect(reader.watches).toEqual([]);
  });
});
