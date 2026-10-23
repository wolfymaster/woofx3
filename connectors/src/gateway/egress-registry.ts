import { EgressActionId, isEgressActionId, type PlatformId } from "@woofx3/api/platform-gateway";
import type { AdapterManifest, EgressHandlers } from "../host/adapter";

/**
 * Every egress handler of the loaded adapters, keyed by (platform, action).
 * Built once from the manifests, so it answers whether a platform supports an
 * action whatever its adapter is doing: a stopped adapter that could perform
 * the action is `unavailable`, not `unsupported`. Whether the adapter is
 * running is the supervisor's to say, read at each request.
 */
export class EgressRegistry {
  private readonly routes = new Map<PlatformId, EgressHandlers>();

  private constructor(private readonly catalog: readonly PlatformId[]) {}

  /**
   * `catalog` is every platform the contract knows (PLATFORM_IDS); an
   * adapter whose id is in it speaks for that platform. Throws on a manifest
   * that a restart could not fix: egress on an adapter that is not a
   * platform, an unknown action, a handler without `handle`, or a
   * (platform, action) registered twice.
   */
  static fromManifests(manifests: readonly AdapterManifest[], catalog: readonly PlatformId[]): EgressRegistry {
    const registry = new EgressRegistry(catalog);
    for (const manifest of manifests) {
      registry.add(manifest);
    }
    return registry;
  }

  /** Platforms whose adapter is loaded, in load order. */
  get platforms(): PlatformId[] {
    return [...this.routes.keys()];
  }

  supports(platform: PlatformId, action: EgressActionId): boolean {
    return this.handler(platform, action) !== undefined;
  }

  handler<A extends EgressActionId>(platform: PlatformId, action: A): EgressHandlers[A] | undefined {
    return this.routes.get(platform)?.[action];
  }

  private add(manifest: AdapterManifest): void {
    const egress = manifest.egress;
    const platform = this.catalog.find((id) => id === manifest.id);
    if (platform === undefined) {
      if (egress !== undefined) {
        throw new Error(`adapter "${manifest.id}" declares egress but is not a platform`);
      }
      return;
    }
    const routes = this.routes.get(platform) ?? {};
    this.routes.set(platform, routes);
    if (egress === undefined) {
      return;
    }
    for (const action of Object.keys(egress)) {
      if (!isEgressActionId(action)) {
        throw new Error(`adapter "${platform}" declares egress for unknown action "${action}"`);
      }
    }
    for (const action of Object.values(EgressActionId)) {
      const handler = egress[action];
      if (handler === undefined) {
        continue;
      }
      if (typeof handler.handle !== "function") {
        throw new Error(`adapter "${platform}" egress for "${action}" has no handle function`);
      }
      if (routes[action] !== undefined) {
        throw new Error(`egress for "${action}" on "${platform}" is registered twice`);
      }
      put(routes, action, handler);
    }
  }
}

function put<A extends EgressActionId>(routes: EgressHandlers, action: A, handler: EgressHandlers[A]): void {
  routes[action] = handler;
}
