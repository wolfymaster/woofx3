/**
 * The refusals `triggerWorkflowByName` throws that a client may recognise by
 * their text: `platform` or `skipConditions` sent without `triggerData`, and
 * a workflow the engine cannot find. A capnweb error carries only its
 * message, so the message is the contract.
 *
 * Both are wire text that engines already shipped send, so their wording must
 * never change. The engine throws them from these definitions
 * (api/src/routes/workflows-execution.ts), and the tests pin the literal
 * text.
 */

/** What the engine throws for `platform` or `skipConditions` without `triggerData`. Frozen wire text. */
export const TRIGGER_OPTIONS_NEED_DATA_MESSAGE =
  "options.platform and options.skipConditions only apply with options.triggerData";

/** What the engine throws for a workflow it cannot find by id or name. Frozen wire text. */
export function workflowNotFoundMessage(workflowNameOrId: string): string {
  return `Workflow "${workflowNameOrId}" not found`;
}
