// The meta each placement of a scene needs beyond its document (its
// module, frame URL, linked resources, media proxy base, declared behavior
// kinds), worked out after a change: kept from before for a placement whose
// widget and theme did not change, framed through the loader for the rest.

import type { Logger } from "@woofx3/common/runtime";
import {
  type MetaChanges,
  type PlacementMeta,
  type SceneDocument,
  stackOrder,
  type Version,
} from "@woofx3/api/scene-editor";
import { storedOfPlacement } from "@woofx3/scene/model";
import { themeOf } from "../../contract/scene-config";
import { changedMeta, errorText, type HeldScene, type MetaPlan, type VersionView } from "./held-scene";
import type { OverlayWidgetInstance } from "./scene-host";

/** Version order for overlay events: a live edit reaches overlays before its copy into the draft. */
export const OVERLAY_ORDER: readonly Version[] = ["published", "draft"];

/** Frames placements given as stored, resolved like a loaded scene's (`OverlayHost.framePlacements`). */
export interface PlacementFramer {
  framePlacements(sceneId: string, entries: unknown[]): Promise<OverlayWidgetInstance[]>;
}

/**
 * What each placement of a framed scene state needs beyond the document, and
 * the placements whose frame barkloader did not give.
 */
export interface Framing {
  meta: Record<string, PlacementMeta>;
  /** Placement ids framed without barkloader's answer (`OverlayWidgetInstance.frameUnavailable`). */
  unframed: Set<string>;
}

export function framingOf(instances: readonly OverlayWidgetInstance[]): Framing {
  const meta: Record<string, PlacementMeta> = {};
  const unframed = new Set<string>();
  for (const instance of instances) {
    meta[instance.id] = placementMetaOf(instance);
    if (instance.frameUnavailable === true && instance.resolved) {
      unframed.add(instance.id);
    }
  }
  return { meta, unframed };
}

function placementMetaOf(instance: OverlayWidgetInstance): PlacementMeta {
  return {
    moduleId: instance.moduleId,
    hostsSurface: instance.hostsSurface,
    frameUrl: instance.frameUrl,
    linkedResources: instance.linkedResources ?? {},
    ...(instance.mediaProxyBase === undefined ? {} : { mediaProxyBase: instance.mediaProxyBase }),
    ...(instance.behaviorKinds === undefined ? {} : { behaviorKinds: instance.behaviorKinds }),
  };
}

export class PlacementMetaResolver {
  constructor(
    private readonly loader: PlacementFramer,
    private readonly logger: Logger
  ) {}

  /**
   * The meta of each version whose document changes to `docs`. A placement
   * keeps the meta it had in this version, or in the other version after the
   * change, when its widget and theme are the same there; others are framed
   * again. With `retryUnframed`, every unframed placement is framed again
   * too, whether its version changed or not. A placement framing gives no
   * frame for, or that framing fails for, keeps whatever meta it had, or
   * none, and is left to the timed retry (see `scheduleReframe`): meta never
   * fails a change, and an edit never waits on barkloader twice.
   */
  async metaFor(
    held: HeldScene,
    docs: Readonly<Record<Version, SceneDocument>>,
    options: { knownPublished?: Framing; retryUnframed?: boolean } = {}
  ): Promise<MetaPlan> {
    const next = { ...held.meta };
    const unframed = { ...held.unframed };
    const changes: Partial<Record<Version, MetaChanges>> = {};
    for (const version of OVERLAY_ORDER) {
      const after = docs[version];
      const known = version === "published" ? options.knownPublished : undefined;
      const retry = options.retryUnframed === true ? held.unframed[version] : new Set<string>();
      if (known === undefined && after === held.state.docs[version] && retry.size === 0) {
        continue;
      }
      const other: Version = version === "published" ? "draft" : "published";
      const framing =
        known ??
        (await this.framedMeta(
          held.sceneId,
          after,
          [
            { doc: held.state.docs[version], meta: held.meta[version], unframed: held.unframed[version] },
            { doc: docs[other], meta: next[other], unframed: unframed[other] },
          ],
          retry
        ));
      next[version] = framing.meta;
      unframed[version] = framing.unframed;
      const changed = changedMeta(held.meta[version], next[version]);
      if (Object.keys(changed).length > 0) {
        changes[version] = changed;
      }
    }
    return { next, unframed, changes };
  }

  private async framedMeta(
    sceneId: string,
    after: SceneDocument,
    candidates: ReadonlyArray<VersionView & { unframed: ReadonlySet<string> }>,
    retry: ReadonlySet<string>
  ): Promise<Framing> {
    const meta: Record<string, PlacementMeta> = {};
    const unframed = new Set<string>();
    const reframe: string[] = [];
    for (const [id, placement] of Object.entries(after.widgets)) {
      const same = retry.has(id)
        ? undefined
        : candidates.find((candidate) => {
            const old = candidate.doc.widgets[id];
            return (
              candidate.meta[id] !== undefined &&
              old !== undefined &&
              old.widget === placement.widget &&
              themeOf(old.settings) === themeOf(placement.settings)
            );
          });
      if (same !== undefined) {
        meta[id] = same.meta[id]!;
        if (same.unframed.has(id)) {
          unframed.add(id);
        }
      } else {
        reframe.push(id);
      }
    }
    if (reframe.length === 0) {
      return { meta, unframed };
    }
    const order = stackOrder(after);
    const entries = reframe.map((id) => storedOfPlacement(id, after.widgets[id]!, order.indexOf(id)));
    try {
      const wanted = new Set(reframe);
      const framing = framingOf(
        (await this.loader.framePlacements(sceneId, entries)).filter((instance) => wanted.has(instance.id))
      );
      Object.assign(meta, framing.meta);
      for (const id of framing.unframed) {
        unframed.add(id);
      }
    } catch (err) {
      this.logger.warn("scene documents: framing placements failed; they keep their meta", {
        sceneId,
        placements: reframe.length,
        error: errorText(err),
      });
      for (const id of reframe) {
        const kept = candidates.find((candidate) => candidate.meta[id] !== undefined);
        if (kept !== undefined) {
          meta[id] = kept.meta[id]!;
        }
        unframed.add(id);
      }
    }
    return { meta, unframed };
  }
}
