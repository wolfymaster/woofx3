// Lifecycle events emitted by the engine when chat commands are created,
// updated, or deleted via the Api. Distinct from chat.command.<slug> in
// Chat/commands.ts, which fires on invocation by a chat user.

export enum EventType {
  Created = "command.created",
  Updated = "command.updated",
  Deleted = "command.deleted",
  /** Run the workflow a command is linked to, for one invocation. Handled by the
   *  workflow engine (Engine.RunCommand); reserved, so no workflow or module
   *  can publish it. */
  RunWorkflow = "workflow.command.run",
}

export interface CommandSnapshot {
  id: string;
  command: string;
  /** The actions this command runs, in order. Shape: `ActionStep` in
   *  shared/clients/typescript/api/api.ts -- the same shape a workflow step has. */
  actions: Array<{
    id?: string;
    action: string;
    function?: string;
    parameters?: Record<string, unknown>;
    $ref?: string;
    dependsOn?: string[];
  }>;
  cooldown: number;
  priority: number;
  enabled: boolean;
  visibility: string;
  groupIds: string[];
  usernames: string[];
  argumentPattern: string;
  /** The workflow this command runs, by id; "" when it has none, and then it
   *  runs `actions`. */
  workflowId: string;
  /** That workflow's tasks, as the workflow stores them. Empty without one. */
  steps: object[];
}

/**
 * Run a command's workflow for one invocation. Sent only after the command
 * matched and passed its checks (cooldown, who may run it, enabled), which is
 * why the engine does not check them again.
 */
export interface CommandWorkflowRun {
  workflowId: string;
  /** The invocation's `chat.command.<slug>` event, which the run reads as its
   *  trigger: `${trigger.data.chatter}` and the rest. */
  event: {
    id: string;
    type: string;
    source: string;
    time: string;
    platform?: string;
    triggeredBy?: string;
    data: Record<string, unknown>;
  };
}

export interface CommandCreated {
  command: CommandSnapshot;
}

export interface CommandUpdated {
  command: CommandSnapshot;
}

export interface CommandDeleted {
  id: string;
  command: string;
}
