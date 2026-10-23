import type { ConnectorsConfig } from "../config";
import type { Adapter, AdapterModule } from "./adapter";
import { ADAPTER_IDS, type AdapterId } from "./adapter-ids";
import type { Clock, IdSource, RandomSource, Timers } from "./deps";
import { subjectCovered } from "./scoped-bus";

export type AdapterLoader = () => Promise<AdapterModule>;

export type AdapterRegistry = Partial<Record<AdapterId, AdapterLoader>>;

/** What the registered adapters are built with. */
export interface AdapterRegistryDeps {
  config: ConnectorsConfig;
  clock: Clock;
  ids: IdSource;
  random: RandomSource;
  timers: Timers;
}

/**
 * The adapters this build runs. Each entry is a literal `import("...")` so
 * `bun build --compile` can see the module and bundles it with its SDK.
 */
export function adapterRegistry(deps: AdapterRegistryDeps): AdapterRegistry {
  return {
    twitch: async () => {
      const { twitchAdapterModule } = await import("../adapters/twitch/adapter");
      return twitchAdapterModule({ config: deps.config.twitch, clock: deps.clock, ids: deps.ids });
    },
    obs: async () => {
      const [{ obsAdapterModule }, { dbProxyEndpointStore }] = await Promise.all([
        import("../adapters/obs/adapter"),
        import("../companion/endpoint-store"),
      ]);
      return obsAdapterModule({
        config: deps.config.obs,
        endpointStore: dbProxyEndpointStore,
        random: deps.random,
        timers: deps.timers,
      });
    },
  };
}

export interface LoadedAdapters {
  adapters: Map<AdapterId, Adapter>;
  /** Each adapter module's host state, undefined for a module without one. */
  hostStates: Map<AdapterId, unknown>;
}

/**
 * Loads every registered adapter, once, building its host state first. Fails startup when an entry names an
 * id the host does not know, or builds an adapter whose manifest claims a
 * different id or subscribes to a subject it serves. The host alone holds
 * served subjects; an adapter subscribed to one would race the host's answer.
 */
export async function loadAdapters(registry: AdapterRegistry): Promise<LoadedAdapters> {
  const adapters = new Map<AdapterId, Adapter>();
  const hostStates = new Map<AdapterId, unknown>();
  for (const [key, load] of Object.entries(registry)) {
    const id = ADAPTER_IDS.find((known) => known === key);
    if (id === undefined) {
      throw new Error(`the adapter registry has an entry for "${key}", which is not an adapter id`);
    }
    if (load === undefined) {
      throw new Error(`the adapter registry entry for "${id}" has no loader`);
    }
    const module = await load();
    const hostState = module.hostState === undefined ? undefined : module.hostState();
    const adapter = module.create(hostState);
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
    hostStates.set(id, hostState);
  }
  return { adapters, hostStates };
}
