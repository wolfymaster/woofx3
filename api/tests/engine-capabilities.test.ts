import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ENGINE_CAPABILITIES,
  type EngineCapabilities,
  GATEABLE_ENGINE_CAPABILITIES,
  supportedEngineCapabilities,
  UNADVERTISED_ENGINE_CAPABILITIES,
} from "@woofx3/api";
import { RPC_METHODS } from "../src/api-session";
import { Entitlements } from "../src/entitlements";
import { engineRoutes } from "../src/routes/engine";

const DOC_PATH = join(import.meta.dir, "../../docs/services/engine-capabilities.md");

/** An ungoverned engine, like every self-hosted one: nothing is withheld. */
const ungoverned = new Entitlements({
  keys: null,
  audience: null,
  gateable: new Set(),
  readGrant: async () => null,
  writeGrant: async () => {},
  now: () => Date.now(),
});

/** The route reads only `entitlements` from its host. */
function getEngineCapabilities(): Promise<EngineCapabilities> {
  const routes = engineRoutes as unknown as { getEngineCapabilities(): Promise<EngineCapabilities> };
  return routes.getEngineCapabilities.call({ entitlements: ungoverned });
}

describe("getEngineCapabilities", () => {
  test("returns schema 1 and every declared capability it advertises", async () => {
    const result = await getEngineCapabilities();
    expect(result.schema).toBe(1);
    const advertised = Object.values(ENGINE_CAPABILITIES).filter((id) => !UNADVERTISED_ENGINE_CAPABILITIES.has(id));
    expect([...result.capabilities].sort()).toEqual(advertised.sort());
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

  test("returns the list sorted and without duplicates", async () => {
    const { capabilities } = await getEngineCapabilities();
    expect(capabilities).toEqual([...new Set(capabilities)].sort());
  });

  test("is reachable over RPC", () => {
    expect(RPC_METHODS).toContain("getEngineCapabilities");
  });

  test("withholds nothing on an ungoverned engine", async () => {
    const { withheld } = await getEngineCapabilities();
    expect(withheld).toEqual([]);
  });
});

describe("ENGINE_CAPABILITIES", () => {
  test("declares each id once", () => {
    const ids = Object.values(ENGINE_CAPABILITIES);
    expect(new Set(ids).size).toBe(ids.length);
    expect(supportedEngineCapabilities()).toHaveLength(ids.length - UNADVERTISED_ENGINE_CAPABILITIES.size);
  });

  test("uses <area>.<feature> ids", () => {
    for (const id of Object.values(ENGINE_CAPABILITIES)) {
      expect(id).toMatch(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/);
    }
  });

  test("documents every id in docs/services/engine-capabilities.md", () => {
    const doc = readFileSync(DOC_PATH, "utf8");
    for (const id of Object.values(ENGINE_CAPABILITIES)) {
      expect(doc).toContain(`| \`${id}\` |`);
    }
  });

  test("lists exactly the gateable ids under Gateable capabilities", () => {
    const doc = readFileSync(DOC_PATH, "utf8");
    const section = doc.split("## Gateable capabilities")[1];
    expect(section).toBeDefined();
    const listed = [...(section ?? "").matchAll(/^- `([^`]+)`/gm)].map((match) => match[1]);
    expect(listed.sort()).toEqual([...GATEABLE_ENGINE_CAPABILITIES].sort());
  });
});
