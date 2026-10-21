import type { Logger } from "@woofx3/common/runtime";
import type { OverlayHost } from "../scene/scene-host";
import type { DeliveryStore } from "./delivery-store";

export interface RemovedPlacementDeps {
  host: Pick<OverlayHost, "placementIds">;
  deliveryStore: Pick<DeliveryStore, "closeAbsent">;
  logger: Logger;
}

/**
 * Close a scene's open deliveries to placements it no longer has. Nothing
 * else would: no page registers a queue for a removed placement, so its
 * deliveries would be sent again by every sweep and on every new stream for
 * as long as the process runs, and reloaded from the database after it
 * restarts.
 *
 * A placement in either version counts, since the editor's preview plays the
 * draft. A scene that cannot be read, or is not there, is left alone: its
 * deliveries are only closed against placements known to be gone.
 */
export async function closeDeliveriesToRemovedPlacements(sceneId: string, deps: RemovedPlacementDeps): Promise<void> {
  let present: Set<string> | null;
  try {
    present = await deps.host.placementIds(sceneId);
  } catch (err) {
    deps.logger.warn("removed placements: scene unavailable; its deliveries are left open", {
      sceneId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (present === null) {
    return;
  }
  const closed = await deps.deliveryStore.closeAbsent(sceneId, present);
  if (closed > 0) {
    deps.logger.info("removed placements: closed deliveries to placements the scene no longer has", {
      sceneId,
      closed,
    });
  }
}
