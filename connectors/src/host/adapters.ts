import type { Adapter, AdapterFactory } from "./adapter";
import { ADAPTER_IDS, type AdapterId } from "./adapter-ids";
import { subjectCovered } from "./scoped-bus";

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
 * different id or subscribes to a subject it serves. The host alone holds
 * served subjects; an adapter subscribed to one would race the host's answer.
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
    for (const served of adapter.manifest.serves) {
      const overlap = adapter.manifest.subscribes.find((pattern) => subjectCovered(pattern, served.subject));
      if (overlap !== undefined) {
        throw new Error(
          `the adapter "${id}" subscribes to "${overlap}", which covers "${served.subject}" that it serves; the host answers served subjects`
        );
      }
    }
    adapters.set(id, adapter);
  }
  return adapters;
}
