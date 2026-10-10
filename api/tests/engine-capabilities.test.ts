import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ENGINE_CAPABILITIES,
  type EngineCapabilities,
  supportedEngineCapabilities,
  UNADVERTISED_ENGINE_CAPABILITIES,
} from "@woofx3/api";
import { RPC_METHODS } from "../src/api-session";
import { engineRoutes } from "../src/routes/engine";

const DOC_PATH = join(import.meta.dir, "../../docs/services/engine-capabilities.md");

/** The route reads nothing from its host, so an empty `this` is enough. */
function getEngineCapabilities(): Promise<EngineCapabilities> {
  const routes = engineRoutes as unknown as { getEngineCapabilities(): Promise<EngineCapabilities> };
  return routes.getEngineCapabilities.call({});
}

describe("getEngineCapabilities", () => {
  test("returns schema 1 and every declared capability it advertises", async () => {
    const result = await getEngineCapabilities();
    expect(result.schema).toBe(1);
    const advertised = Object.values(ENGINE_CAPABILITIES).filter((id) => !UNADVERTISED_ENGINE_CAPABILITIES.has(id));
    expect([...result.capabilities].sort()).toEqual(advertised.sort());
  });

  test("does not advertise scene editor protocol 2 while sceneManager serves protocol 1", async () => {
    const { capabilities } = await getEngineCapabilities();
    expect(capabilities).toContain(ENGINE_CAPABILITIES.scenesEditorSessions);
    expect(capabilities).not.toContain(ENGINE_CAPABILITIES.scenesEditorSync);
  });

  test("returns the list sorted and without duplicates", async () => {
    const { capabilities } = await getEngineCapabilities();
    expect(capabilities).toEqual([...new Set(capabilities)].sort());
  });

  test("is reachable over RPC", () => {
    expect(RPC_METHODS).toContain("getEngineCapabilities");
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
});
