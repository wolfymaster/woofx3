// Lifecycle events emitted by the engine when chat commands are created,
// updated, or deleted via the Api. Distinct from chat.command.<slug> in
// Chat/commands.ts, which fires on invocation by a chat user.

import type { CommandSnapshot } from "@woofx3/api/command";
import type { ChatCommandEvent } from "../Chat/commands";

export type { CommandSnapshot };

export enum EventType {
  Created = "command.created",
  Updated = "command.updated",
  Deleted = "command.deleted",
  /** Run the workflow a command is linked to, for one invocation. Handled by the
   *  workflow engine (Engine.RunCommand); reserved, so no workflow or module
   *  can publish it. */
  ExecuteWorkflow = "workflow.command.execute",
}

/**
 * Run a command's workflow for one invocation. Sent only after the command
 * matched and passed its checks (enabled, who may run it, cooldown), which is
 * why the engine does not check them again.
 */
export interface CommandWorkflowExecution {
  workflowId: string;
  /** The invocation's `chat.command.<slug>` event, the very one announced on
   *  that subject, which the run reads as its trigger: `${trigger.data.chatter}`
   *  and the rest. */
  event: ChatCommandEvent;
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
