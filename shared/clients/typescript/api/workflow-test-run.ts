/**
 * Telling whether an engine takes `triggerWorkflowByName`'s `options` (sample
 * data, skip conditions, dry run) without risking a run.
 *
 * An engine older than the options ignores them, so a real call with
 * `dryRun` would run the workflow for real there. The probe instead names a
 * workflow nobody can have and passes `platform` without `triggerData`. An
 * engine with options refuses that combination before it looks the workflow
 * up (`TRIGGER_OPTIONS_NEED_DATA_MESSAGE`); an older one ignores the options
 * and fails to find the workflow (`workflowNotFoundMessage`). Neither starts
 * a run.
 *
 * Both messages are wire text that engines already shipped send, so their
 * wording must never change: a reworded message would make every older
 * engine probe as `unknown`. The engine throws them from these definitions
 * (api/src/routes/workflows-execution.ts), and the tests pin the literal
 * text.
 *
 * Like the other shared readers, a rejection that carries no message reads
 * as no answer (`unknown`).
 */

/** A workflow name no workflow can have: a control character cannot be typed into one. */
export const OPTIONS_PROBE_WORKFLOW = "\u0000woofx3-options-probe";

/** The probe's options: `platform` without `triggerData`, the combination an engine with options refuses. */
export const OPTIONS_PROBE_OPTIONS = { platform: "probe" } as const;

/** What an engine with options throws for `platform` or `skipConditions` without `triggerData`. Frozen wire text. */
export const TRIGGER_OPTIONS_NEED_DATA_MESSAGE =
  "options.platform and options.skipConditions only apply with options.triggerData";

/** What any engine throws for a workflow it cannot find by id or name. Frozen wire text. */
export function workflowNotFoundMessage(workflowNameOrId: string): string {
  return `Workflow "${workflowNameOrId}" not found`;
}

/**
 * `supported`: the engine takes the options. `unsupported`: it predates them.
 * `unknown`: the probe failed some other way (the engine unreachable, say),
 * so a caller can ask again later.
 */
export type TriggerOptionsSupport = "supported" | "unsupported" | "unknown";

/**
 * Whether the engine takes test-run options, from what it rejected the probe
 * with: call `triggerWorkflowByName(OPTIONS_PROBE_WORKFLOW, {}, undefined,
 * undefined, undefined, OPTIONS_PROBE_OPTIONS)` and pass the rejection here.
 * Takes the rejection itself, or its message. A probe that resolved (no
 * engine does) is `unknown`.
 */
export function classifyOptionsProbe(rejection: unknown): TriggerOptionsSupport {
  const message = rejection instanceof Error ? rejection.message : typeof rejection === "string" ? rejection : null;
  if (message === null) {
    return "unknown";
  }
  if (message.includes(TRIGGER_OPTIONS_NEED_DATA_MESSAGE)) {
    return "supported";
  }
  if (message.includes(workflowNotFoundMessage(OPTIONS_PROBE_WORKFLOW))) {
    return "unsupported";
  }
  return "unknown";
}
