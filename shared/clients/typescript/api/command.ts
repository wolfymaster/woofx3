/**
 * The chat command shapes every service shares: the api returns them, the
 * engine's command events and webhooks carry them, and the commander reads
 * them. Kept apart from api.ts so a service can import them without the whole
 * api client.
 */

import type { TaskDefinition } from "./workflow-definition";

/**
 * One action to run: the same shape a workflow step has, because it is the
 * same thing. `action` names the engine handler (`function`, `alert`,
 * `print`, ...); `function` carries the canonical function id when the
 * handler is `function`; `$ref` records which module action this came from,
 * for the reference graph.
 *
 * Parameters may contain `${trigger.data...}` expressions, resolved against
 * the event the actions run for.
 */
export interface ActionStep {
  /** Defaults to the step's position ("action-1", ...) when omitted. */
  id?: string;
  action: string;
  function?: string;
  parameters?: Record<string, unknown>;
  $ref?: string;
  /** Omit to run after the previous action; `[]` to run alongside it. */
  dependsOn?: string[];
}

/** "public" always allows any user; "restricted" requires the invoking user
 * to belong to one of groupIds or be listed in usernames. */
export type CommandVisibility = "public" | "restricted";

/**
 * Snapshot of a chat command as the engine stores it.
 *
 * A command with steps runs a stored workflow of its own, `workflowId`, whose
 * tasks are `steps`: actions, conditions, waits and pauses, exactly as any
 * workflow holds them. Its trigger has type "command", so only the command
 * starts it, once it has matched and passed its cooldown and permission
 * checks; the `chat.command.<slug>` event every invocation announces, for
 * other workflows to react to, does not.
 *
 * A command with no workflow runs `actions`, in order, without one. That is a
 * command the engine could not link to a workflow when it upgraded; it is
 * linked when its steps are next saved. A command with neither only
 * announces itself.
 */
export interface CommandSnapshot {
  id: string;
  command: string;
  /** Empty for a command with a workflow. */
  actions: ActionStep[];
  /** The workflow this command runs, or "" when it has none. */
  workflowId: string;
  /** That workflow's tasks; empty without one. */
  steps: TaskDefinition[];
  /**
   * Why the command has no workflow when it should have one, or "". Either the
   * engine could not turn its actions into a workflow when it upgraded (it
   * then keeps running `actions`, and tries again on its next start), or the
   * workflow it ran no longer exists.
   */
  workflowError: string;
  cooldown: number;
  priority: number;
  enabled: boolean;
  visibility: CommandVisibility;
  groupIds: string[];
  usernames: string[];
  /**
   * Optional "{variable}" placeholders declaring named arguments, e.g.
   * "{songTitle}" or "{userA} {userB}" - `command` itself never contains
   * braces, it's always the bare trigger word ("sr", "hug"). The extracted
   * values reach the command's actions on the trigger event, as
   * `${trigger.data.variables.songTitle}`.
   *
   * Extraction rule: exactly one variable captures the entire remainder of
   * the message (not split on whitespace) - `!sr {songTitle}` against
   * "!sr Life is a highway" yields `songTitle: "Life is a highway"`. More
   * than one variable: every variable but the last consumes one
   * whitespace-delimited token, and the last captures whatever remains -
   * `!hug {userA} {userB}` against "!hug alice bob" yields
   * `userA: "alice", userB: "bob"`.
   *
   * Each `{name}` must be a single word or dot-separated words
   * (`^\w+(\.\w+)*$`) - no other characters are valid. The engine rejects
   * `createCommand`/`updateCommand` calls with an invalid name in this
   * pattern.
   */
  argumentPattern: string;
}
