// Lifecycle events emitted by the engine when chat commands are created,
// updated, or deleted via the Api. Distinct from chat.command.<slug> in
// Chat/commands.ts, which fires on invocation by a chat user.

export enum EventType {
  Created = "command.created",
  Updated = "command.updated",
  Deleted = "command.deleted",
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
