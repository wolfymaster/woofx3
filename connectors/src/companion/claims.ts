// Which host adapter owns which local endpoint. Claims come from the adapter
// manifests, so they are known from startup whether or not the adapter runs,
// and a module can never reach an endpoint an adapter guards.

import type { AdapterManifest } from "../host/adapter";
import type { AdapterId } from "../host/adapter-ids";
import { isLocalEndpointRef } from "./endpoints";
import type { LocalEndpointRef } from "./types";

export interface EndpointClaim {
  ref: LocalEndpointRef;
  owner: AdapterId;
}

/** An adapter asked about an endpoint its manifest does not claim: a bug in the adapter, never a runtime condition. */
export class UnclaimedEndpointError extends Error {
  constructor(adapter: AdapterId, ref: LocalEndpointRef) {
    super(
      `the adapter "${adapter}" does not claim the local endpoint ${endpointKey(ref)}; list it in its manifest's localEndpoints`
    );
    this.name = "UnclaimedEndpointError";
  }
}

/** One stable key per endpoint. A `/` is in neither id, so two refs never share a key. */
export function endpointKey(ref: LocalEndpointRef): string {
  return `${ref.moduleId}/${ref.endpointId}`;
}

export class ClaimRegistry {
  private constructor(private readonly byKey: ReadonlyMap<string, EndpointClaim>) {}

  /** Throws, stopping startup, on a malformed ref or an endpoint two manifests (or one, twice) claim. */
  static fromManifests(manifests: Iterable<Pick<AdapterManifest, "id" | "localEndpoints">>): ClaimRegistry {
    const byKey = new Map<string, EndpointClaim>();
    for (const manifest of manifests) {
      for (const ref of manifest.localEndpoints ?? []) {
        if (!isLocalEndpointRef(ref)) {
          throw new Error(`the adapter "${manifest.id}" claims a malformed local endpoint ${JSON.stringify(ref)}`);
        }
        const key = endpointKey(ref);
        const existing = byKey.get(key);
        if (existing !== undefined) {
          throw new Error(
            `the local endpoint ${key} is claimed by both "${existing.owner}" and "${manifest.id}"; one adapter owns each endpoint`
          );
        }
        byKey.set(key, { ref: { moduleId: ref.moduleId, endpointId: ref.endpointId }, owner: manifest.id });
      }
    }
    return new ClaimRegistry(byKey);
  }

  /** The adapter that owns the endpoint, or null when module code may reach it. */
  ownerOf(ref: LocalEndpointRef): AdapterId | null {
    return this.byKey.get(endpointKey(ref))?.owner ?? null;
  }

  claims(): EndpointClaim[] {
    return [...this.byKey.values()];
  }

  /** Throws `UnclaimedEndpointError` unless `adapter` claims `ref`. */
  assertClaimedBy(adapter: AdapterId, ref: LocalEndpointRef): void {
    if (this.ownerOf(ref) !== adapter) {
      throw new UnclaimedEndpointError(adapter, ref);
    }
  }
}
