import { describe, expect, test } from "bun:test";
import { listEngineModules } from "../src/engine-modules";
import { modulesRoutes } from "../src/routes/modules";

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** Module rows as the db client returns them: optional provenance is undefined or null when unset. */
const ROWS = [
  {
    name: "Cozy",
    moduleId: "cozy",
    version: "2.0.0",
    moduleKey: "cozy-v2:2.0.0:abcdef0",
    state: "active",
    createdByType: "CLIENT",
    manifest: "{}",
    marketplaceListingId: "cozy-v2",
    marketplaceEdition: 2,
  },
  {
    name: "Hand made",
    moduleId: "hand_made",
    version: "1.0.0",
    moduleKey: "hand_made:1.0.0:1234567",
    state: "active",
    createdByType: "CLIENT",
    manifest: "{}",
    marketplaceListingId: null,
    marketplaceEdition: null,
  },
];

const db = {
  async listModules() {
    return ROWS;
  },
  async getModuleByName(name: string) {
    return ROWS.find((row) => row.name === name) ?? null;
  },
};

function getModule(name: string) {
  const route = modulesRoutes.getModule as unknown as (id: string) => Promise<Record<string, unknown> | null>;
  return route.call({ db, logger }, name);
}

describe("marketplace provenance on installed modules", () => {
  test("listEngineModules carries a module's listing and edition", async () => {
    const modules = await listEngineModules(db as never, logger as never);
    expect(modules[0]).toMatchObject({ marketplaceListingId: "cozy-v2", marketplaceEdition: 2 });
  });

  test("listEngineModules leaves both fields out for a module from anywhere else", async () => {
    const modules = await listEngineModules(db as never, logger as never);
    expect(modules[1]).not.toHaveProperty("marketplaceListingId");
    expect(modules[1]).not.toHaveProperty("marketplaceEdition");
  });

  test("getModule carries a module's listing and edition", async () => {
    expect(await getModule("Cozy")).toMatchObject({ marketplaceListingId: "cozy-v2", marketplaceEdition: 2 });
  });

  test("getModule leaves both fields out for a module from anywhere else", async () => {
    const found = await getModule("Hand made");
    expect(found).not.toHaveProperty("marketplaceListingId");
    expect(found).not.toHaveProperty("marketplaceEdition");
  });
});
