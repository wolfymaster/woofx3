import type { Adapter, AdapterFactory } from "./adapter";
import { ADAPTER_IDS, type AdapterId } from "./adapter-ids";

export type AdapterLoader = () => Promise<AdapterFactory>;

export type AdapterRegistry = Partial<Record<AdapterId, AdapterLoader>>;

/**
 * The adapters this build runs. Each entry is a literal `import("./...")` so
 * `bun build --compile` can see the module and bundles it with its SDK.
 */
export const ADAPTERS: AdapterRegistry = {};

/**
 * Loads every registered adapter, once. Fails startup when an entry names an
 * id the host does not know, or builds an adapter whose manifest claims a
 * different id.
 */
export async function loadAdapters(registry: AdapterRegistry): Promise<Map<AdapterId, Adapter>> {
  const adapters = new Map<AdapterId, Adapter>();
  for (const [key, load] of Object.entries(registry)) {
    const id = ADAPTER_IDS.find((known) => known === key);
    if (id === undefined) {
      throw new Error(`the adapter registry has an entry for "${key}", which is not an adapter id`);
    }
    if (load === undefined) {
      throw new Error(`the adapter registry entry for "${id}" has no loader`);
    }
    const adapter = (await load())();
    if (adapter.manifest.id !== id) {
      throw new Error(`the adapter registered as "${id}" says its id is "${adapter.manifest.id}"`);
    }
    adapters.set(id, adapter);
  }
  return adapters;
}
