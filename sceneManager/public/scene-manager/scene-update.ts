// What a saved scene change means for the widgets already on the page.
//
// A save must not restart every widget on stream to apply a change to one, so
// the page fetches the saved config and works out, per placement, the least
// it has to do. A placement whose frame
// document is the same keeps its frame: it is moved, and its settings are
// patched in or, when the widget's script read a changed one, it is swapped
// for a fresh frame once that has painted. Only a different frame document
// (another widget, version or theme) means a new frame for that reason.

import { sameValue } from "@woofx3/scene/model";
import { themeOf, type WidgetPlacementConfig } from "../../contract/scene-config";

export interface ScenePlan {
  /** Placements no longer on the scene. */
  remove: string[];
  /** New placements. */
  mount: WidgetPlacementConfig[];
  /** Placements whose frame document differs: swapped for a new frame. */
  replace: WidgetPlacementConfig[];
  /** Placements whose frame stays: re-placed, and their settings brought up to date. */
  place: WidgetPlacementConfig[];
  /** Every placement id, bottom of the stack first. */
  order: string[];
}

export function planSceneUpdate(
  current: readonly WidgetPlacementConfig[],
  next: readonly WidgetPlacementConfig[]
): ScenePlan {
  const currentById = new Map(current.map((placement) => [placement.id, placement]));
  const nextIds = new Set(next.map((placement) => placement.id));
  const plan: ScenePlan = {
    remove: current.filter((placement) => !nextIds.has(placement.id)).map((placement) => placement.id),
    mount: [],
    replace: [],
    place: [],
    order: next.map((placement) => placement.id),
  };
  for (const placement of next) {
    const existing = currentById.get(placement.id);
    if (!existing) {
      plan.mount.push(placement);
    } else if (sameFrame(existing, placement)) {
      plan.place.push(placement);
    } else {
      plan.replace.push(placement);
    }
  }
  return plan;
}

/**
 * Whether two placements load the same frame document. The frame URL names
 * exactly that (widget, version, theme); settings are not part of it, since
 * the page hands them to the frame. An alert area has no frame of its own and
 * is drawn from its settings, so for one they are part of it.
 */
function sameFrame(a: WidgetPlacementConfig, b: WidgetPlacementConfig): boolean {
  return (
    a.widgetCanonicalId === b.widgetCanonicalId &&
    a.moduleId === b.moduleId &&
    a.hostsSurface === b.hostsSurface &&
    a.frameUrl === b.frameUrl &&
    (a.hostsSurface === "" || sameValue(a.settings, b.settings))
  );
}
