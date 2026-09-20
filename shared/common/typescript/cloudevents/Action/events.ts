// A request to run actions that belong to no workflow. The workflow engine
// subscribes and runs them through its own executor (Engine.RunActions);
// nothing else does, so this is the one way to run an action outside a
// workflow.

export enum EventType {
  Execute = "action.execute",
}

/** One action to run. Same shape as a workflow step, because it is one. */
export interface ActionStep {
  id?: string;
  action: string;
  function?: string;
  parameters?: Record<string, unknown>;
  $ref?: string;
  /** Omit to run after the previous action; `[]` to run alongside it. */
  dependsOn?: string[];
}

export interface ActionExecute {
  /** Names the run in the engine's logs, e.g. `command:hug`. */
  label: string;
  applicationId: string;
  actions: ActionStep[];
  /** What the actions resolve `${trigger.data...}` against. */
  event: {
    id: string;
    type: string;
    source: string;
    time: string;
    data: Record<string, unknown>;
  };
}
