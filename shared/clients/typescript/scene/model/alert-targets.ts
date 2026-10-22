/**
 * Which alert widgets an Alert step can reach, read from engine data: the
 * stored placements of scenes, and the steps of workflows and chat commands.
 *
 * An Alert step (a workflow task or command action whose `action` is
 * `alert`) plays on every alert widget whose name equals its `target`, by
 * the routing rules in alert-names.ts. A dashboard uses these functions to
 * offer only targets something answers to, and to warn when an edit to a
 * scene leaves steps with nowhere to play.
 *
 * Input is read leniently: an empty string where an id belongs counts as
 * absent, and an entry without the field that identifies it is skipped.
 */

import { alertRouteName, alertWidgetName } from "./alert-names";
import { storedWidgetId } from "./stored-placement";

/** The workflow engine's Alert action id (workflow/app.go registers it). */
export const ALERT_ACTION_ID = "alert";

/** The name an Alert step plays on: its `target` parameter, or the default when blank. */
export function alertStepTarget(parameters: Record<string, unknown> | undefined): string {
  return alertRouteName(parameters?.target);
}

/**
 * The targets of the Alert steps among `steps`, in order. Takes a workflow's
 * tasks or a command's actions as stored: both carry the action id in
 * `action` and its settings in `parameters`. Entries of any other shape are
 * not steps the engine would run, and are skipped.
 */
export function alertStepTargets(steps: readonly unknown[]): string[] {
  const targets: string[] = [];
  for (const step of steps) {
    if (!isRecord(step) || step.action !== ALERT_ACTION_ID) {
      continue;
    }
    targets.push(alertStepTarget(isRecord(step.parameters) ? step.parameters : undefined));
  }
  return targets;
}

/** A stored placement, reduced to what alert routing reads. */
export interface PlacedWidget {
  /** The canonical id of the widget placed. */
  widgetId: string;
  settings?: Record<string, unknown>;
}

/**
 * A scene's stored placements (the entries of its `widgets_json`) as alert
 * routing reads them. An entry that names no widget, or is not an object,
 * is one sceneManager cannot place either, and is left out.
 */
export function placedWidgetsOf(entries: readonly unknown[]): PlacedWidget[] {
  return entries.flatMap((entry): PlacedWidget[] => {
    if (!isRecord(entry)) {
      return [];
    }
    const widgetId = storedWidgetId(entry);
    if (widgetId === "") {
      return [];
    }
    return [{ widgetId, settings: isRecord(entry.settings) ? entry.settings : undefined }];
  });
}

/**
 * The names a scene's alert widgets answer to. `alertWidgetIds` are the
 * canonical ids of the widgets that host alerts (`hostsSurface` is
 * `ALERT_SURFACE`).
 */
export function alertWidgetNamesOf(
  placements: Iterable<PlacedWidget>,
  alertWidgetIds: ReadonlySet<string>
): Set<string> {
  const names = new Set<string>();
  for (const placement of placements) {
    if (alertWidgetIds.has(placement.widgetId)) {
      names.add(alertWidgetName(placement.settings));
    }
  }
  return names;
}

/** A scene by its id and its stored placements. */
export interface AlertTargetScene {
  id: string;
  /** The scene's stored placement entries, as `placedWidgetsOf` reads them. */
  widgets: readonly unknown[];
}

/** The names the alert widgets of `scenes` answer to, across every scene. */
export function alertWidgetNamesAcross(
  scenes: readonly AlertTargetScene[],
  alertWidgetIds: ReadonlySet<string>
): Set<string> {
  const names = new Set<string>();
  for (const scene of scenes) {
    for (const name of alertWidgetNamesOf(placedWidgetsOf(scene.widgets), alertWidgetIds)) {
      names.add(name);
    }
  }
  return names;
}

/** Something that runs Alert steps: a workflow, or a chat command with actions of its own. */
export interface AlertPlayer {
  kind: "workflow" | "command";
  /** How a person knows it: the workflow's name, or the command as typed in chat ("!hype"). */
  name: string;
  /** The workflow's tasks, or the command's actions. */
  steps: readonly unknown[];
}

/** An Alert step's target, and what runs the step. */
export interface AlertTargetUse {
  target: string;
  kind: AlertPlayer["kind"];
  name: string;
}

/** Every Alert step target among `players`, in order. */
export function alertTargetUses(players: readonly AlertPlayer[]): AlertTargetUse[] {
  return players.flatMap(({ kind, name, steps }) => alertStepTargets(steps).map((target) => ({ target, kind, name })));
}

/** What a scene editor needs to tell whether an edit leaves Alert steps with nowhere to play. */
export interface AlertTargetUsage {
  /** The canonical ids of the widgets that host alerts, so the editor can tell its own alert widgets apart. */
  alertWidgetIds: string[];
  /** Names the alert widgets of every scene but the one being edited answer to. */
  elsewhere: string[];
  /** Every Alert step's target, in workflows and chat commands. */
  uses: AlertTargetUse[];
}

/**
 * The usage for an editor of scene `sceneId`. That scene is left out of
 * `elsewhere`: the editor holds its draft, and knows its names better than
 * any stored copy.
 */
export function alertTargetUsage(
  sceneId: string,
  sources: {
    scenes: readonly AlertTargetScene[];
    players: readonly AlertPlayer[];
    alertWidgetIds: ReadonlySet<string>;
  }
): AlertTargetUsage {
  const others = sources.scenes.filter((scene) => scene.id !== sceneId);
  return {
    alertWidgetIds: [...sources.alertWidgetIds],
    elsewhere: [...alertWidgetNamesAcross(others, sources.alertWidgetIds)],
    uses: alertTargetUses(sources.players),
  };
}

/** A target an edit leaves with nowhere to play, and what plays on it. */
export interface OrphanedAlertTarget {
  target: string;
  uses: AlertTargetUse[];
}

/**
 * The targets an edit to one scene leaves with nowhere to play: names in use
 * that the scene answered to `before`, and that neither the scene `after`
 * nor any other scene (`elsewhere`) answers to. A target nothing answered to
 * before the edit is left out, since the edit did not cause it. Each use is
 * listed once per target, however many of its steps play there.
 */
export function orphanedAlertTargets(
  uses: readonly AlertTargetUse[],
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
  elsewhere: ReadonlySet<string>
): OrphanedAlertTarget[] {
  const orphaned = new Map<string, AlertTargetUse[]>();
  for (const use of uses) {
    if (!before.has(use.target) || after.has(use.target) || elsewhere.has(use.target)) {
      continue;
    }
    const list = orphaned.get(use.target) ?? [];
    if (!list.some((seen) => seen.kind === use.kind && seen.name === use.name)) {
      list.push(use);
    }
    orphaned.set(use.target, list);
  }
  return Array.from(orphaned, ([target, list]) => ({ target, uses: list }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
