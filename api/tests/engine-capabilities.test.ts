import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ENGINE_CAPABILITIES,
  type EngineCapabilities,
  type EngineHosting,
  type EngineInfo,
  HOSTING_ENGINE_CAPABILITIES,
  supportedEngineCapabilities,
  UNADVERTISED_ENGINE_CAPABILITIES,
} from "@woofx3/api";
import { SINCE } from "../../.github/scripts/capability-since.mjs";
import { RPC_METHODS } from "../src/api-session";
import { engineRoutes } from "../src/routes/engine";

const DOC_PATH = join(import.meta.dir, "../../docs/services/engine-capabilities.md");

/** The route reads only `hosting` from its host. */
function getEngineCapabilities(hosting: EngineHosting | null = null): Promise<EngineCapabilities> {
  const routes = engineRoutes as unknown as { getEngineCapabilities(): Promise<EngineCapabilities> };
  return routes.getEngineCapabilities.call({ hosting });
}

/** `getEngineInfo` on a host whose overlay URL is the configured sceneManager URL. */
function getEngineInfo(hosting: EngineHosting | null): Promise<EngineInfo> {
  const routes = engineRoutes as unknown as { getEngineInfo(): Promise<EngineInfo> };
  return routes.getEngineInfo.call({
    db: { getSetting: async () => "" },
    sceneManagerUrl: "http://scene.test",
    version: "v1",
    hosting,
  });
}

/** Every declared id an engine with `hosting` advertises. */
function advertisedFor(hosting: EngineHosting | null): string[] {
  return Object.values(ENGINE_CAPABILITIES)
    .filter((id) => !UNADVERTISED_ENGINE_CAPABILITIES.has(id))
    .filter((id) => {
      const required = HOSTING_ENGINE_CAPABILITIES.get(id);
      return required === undefined || required === hosting;
    })
    .sort();
}

describe("getEngineCapabilities", () => {
  test("returns schema 1 and every declared capability it advertises", async () => {
    const result = await getEngineCapabilities();
    expect(result.schema).toBe(1);
    expect([...result.capabilities].sort()).toEqual(advertisedFor(null));
  });

  test("advertises engine.localMode only when the engine is hosted locally", async () => {
    expect((await getEngineCapabilities()).capabilities).not.toContain(ENGINE_CAPABILITIES.engineLocalMode);
    expect((await getEngineCapabilities("managed")).capabilities).not.toContain(ENGINE_CAPABILITIES.engineLocalMode);
    expect((await getEngineCapabilities("self")).capabilities).not.toContain(ENGINE_CAPABILITIES.engineLocalMode);
    const local = await getEngineCapabilities("local");
    expect(local.capabilities).toContain(ENGINE_CAPABILITIES.engineLocalMode);
    expect(local.capabilities).toEqual(advertisedFor("local"));
  });

  test("advertises the same build capabilities whatever the hosting", async () => {
    const unset = (await getEngineCapabilities()).capabilities;
    for (const hosting of ["managed", "self", "local"] as const) {
      const withHosting = (await getEngineCapabilities(hosting)).capabilities;
      expect(withHosting.filter((id) => !HOSTING_ENGINE_CAPABILITIES.has(id as never))).toEqual(unset);
    }
  });

  test("advertises scene editor protocol 2 and no longer protocol 1", async () => {
    const { capabilities } = await getEngineCapabilities();
    expect(capabilities).toContain(ENGINE_CAPABILITIES.scenesEditorSync);
    expect(capabilities).not.toContain(ENGINE_CAPABILITIES.scenesEditorSessions);
  });

  test("advertises alert queue controls, whose methods are reachable over RPC", async () => {
    const { capabilities } = await getEngineCapabilities();
    expect(capabilities).toContain(ENGINE_CAPABILITIES.alertsQueueControls);
    expect(RPC_METHODS).toContain("skipCurrentAlert");
    expect(RPC_METHODS).toContain("clearAlertQueue");
  });

  test("advertises the workflow features the engine has shipped since v0.4.0", async () => {
    const { capabilities } = await getEngineCapabilities();
    expect(capabilities).toEqual(
      expect.arrayContaining([
        "workflow.delayWait",
        "workflow.testRunOptions",
        "workflow.dryRun",
        "workflow.realCancel",
        "workflow.health",
      ])
    );
    expect(RPC_METHODS).toContain("triggerWorkflowByName");
    expect(RPC_METHODS).toContain("cancelWorkflow");
    expect(RPC_METHODS).toContain("getWorkflowHealth");
  });

  test("returns the list sorted and without duplicates", async () => {
    const { capabilities } = await getEngineCapabilities();
    expect(capabilities).toEqual([...new Set(capabilities)].sort());
  });

  test("is reachable over RPC", () => {
    expect(RPC_METHODS).toContain("getEngineCapabilities");
  });
});

describe("getEngineInfo hosting", () => {
  test("is left out when the deployment does not declare it", async () => {
    const info = await getEngineInfo(null);
    expect("hosting" in info).toBe(false);
    expect(info).toEqual({
      engineSceneOverlayBaseUrl: "http://scene.test/overlay/scene",
      overlayPublicUrl: "http://scene.test",
      version: "v1",
    });
  });

  test("is the declared hosting", async () => {
    for (const hosting of ["managed", "self", "local"] as const) {
      expect((await getEngineInfo(hosting)).hosting).toBe(hosting);
    }
  });
});

describe("ENGINE_CAPABILITIES", () => {
  test("declares each id once", () => {
    const ids = Object.values(ENGINE_CAPABILITIES);
    expect(new Set(ids).size).toBe(ids.length);
    expect(supportedEngineCapabilities()).toHaveLength(
      ids.length - UNADVERTISED_ENGINE_CAPABILITIES.size - HOSTING_ENGINE_CAPABILITIES.size
    );
  });

  test("uses <area>.<feature> ids", () => {
    for (const id of Object.values(ENGINE_CAPABILITIES)) {
      expect(id).toMatch(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/);
    }
  });

  test("documents every id in docs/services/engine-capabilities.md, with its first release", () => {
    const doc = readFileSync(DOC_PATH, "utf8");
    for (const id of Object.values(ENGINE_CAPABILITIES)) {
      const row = doc.split("\n").find((line) => line.startsWith(`| \`${id}\` |`));
      expect(row, `no row for ${id}`).toBeDefined();
      expect(row?.split(" | ")[1]).toMatch(SINCE);
    }
  });
});
