import { ALERT_SURFACE, alertTarget, alertWidgetName } from "./alert-layout";
import { collectMediaKeys, MAX_MEDIA_KEYS } from "./media-keys";
import type { OverlayWidgetInstance } from "./scene-host";

/** The slice of the db client the manifest reads. The real `DbClient` satisfies it. */
export interface WorkflowStepsSource {
  /** The `steps_json` of every enabled workflow. */
  listEnabledWorkflowSteps(): Promise<string[]>;
}

/**
 * The media a scene can be asked to play, for the page to fetch as it loads:
 * what its placements' settings reference, and what the layout of every
 * enabled workflow's alert step that targets one of its alert widgets does.
 *
 * A target that is an expression is only known when the alert fires, so its
 * layout counts as targeting every alert widget. Prefetching media that never
 * plays costs a download; missing media that does costs the alert its timing.
 */
export function sceneMediaKeys(instances: OverlayWidgetInstance[], workflowSteps: string[]): string[] {
  const keys = new Set<string>();
  const alertWidgetNames = new Set<string>();
  for (const instance of instances) {
    if (instance.hostsSurface === ALERT_SURFACE) {
      alertWidgetNames.add(alertWidgetName(instance));
    } else if (instance.hostsSurface === "") {
      collectMediaKeys(instance.settings, keys);
    }
  }
  if (alertWidgetNames.size === 0) {
    return [...keys];
  }
  for (const stepsJson of workflowSteps) {
    for (const parameters of alertStepParameters(stepsJson)) {
      if (keys.size >= MAX_MEDIA_KEYS) {
        return [...keys];
      }
      const target = parameters.target;
      const targetsScene =
        (typeof target === "string" && target.includes("${")) || alertWidgetNames.has(alertTarget(parameters));
      if (targetsScene) {
        collectMediaKeys(parameters.layout, keys);
      }
    }
  }
  return [...keys];
}

/** The parameters of each enabled alert step; a workflow whose steps do not parse has none. */
function alertStepParameters(stepsJson: string): Record<string, unknown>[] {
  let steps: unknown;
  try {
    steps = JSON.parse(stepsJson || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(steps)) {
    return [];
  }
  const found: Record<string, unknown>[] = [];
  for (const step of steps) {
    if (!isRecord(step) || step.type !== "action" || step.action !== "alert" || step.disabled === true) {
      continue;
    }
    if (isRecord(step.parameters)) {
      found.push(step.parameters);
    }
  }
  return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
