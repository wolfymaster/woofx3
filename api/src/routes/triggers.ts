import type { WorkflowCatalog } from "@woofx3/api";
import { type ActionDefinition, type TriggerDefinition, WEBHOOK_TRANSPORT } from "@woofx3/api/webhooks";
import type * as module_action from "@woofx3/db/module_action.pb";
import type * as module_trigger from "@woofx3/db/module_trigger.pb";
import { routeModule } from "./context";
import { availableFunctions } from "./helpers";

/**
 * The key the registration webhook gives a module trigger or action (the db's
 * `projectionKeyFor`). The UI identifies both by it, so a listing without it
 * erases the key the UI stored at registration: its sync then takes every
 * webhook endpoint for gone, and a resource page can no longer find the action
 * behind its buttons. Empty for a row no module owns.
 */
export function moduleProjectionKey(
  row: { createdByType: string; createdByRef: string; manifestId: string },
  kind: "trigger" | "action"
): string {
  if (row.createdByType !== "MODULE" || !row.createdByRef || !row.manifestId) {
    return "";
  }
  return `${row.createdByRef}:${kind}:${row.manifestId}`;
}

/**
 * A stored trigger as clients see it. `handler` names a module function,
 * which stays inside the engine. An empty `sentence` is the column default,
 * not a declared template.
 */
function triggerDefinition({ handler: _handler, sentence, ...rest }: module_trigger.Trigger): TriggerDefinition {
  const definition = sentence ? { ...rest, sentence } : rest;
  const projectionKey = moduleProjectionKey(definition, "trigger");
  return projectionKey ? { ...definition, projectionKey } : definition;
}

/** A stored action as clients see it; as for triggers, an empty `sentence` is the column default. */
function actionDefinition({ sentence, ...rest }: module_action.Action): ActionDefinition {
  const definition = sentence ? { ...rest, sentence } : rest;
  const projectionKey = moduleProjectionKey(definition, "action");
  return projectionKey ? { ...definition, projectionKey } : definition;
}

export const triggersRoutes = routeModule({
  async getTriggers(createdByType?: string, createdByRef?: string): Promise<TriggerDefinition[]> {
    return (await this.db.listTriggers(createdByType, createdByRef)).map(triggerDefinition);
  },

  async getActions(createdByType?: string, createdByRef?: string): Promise<ActionDefinition[]> {
    return (await this.db.listActions(createdByType, createdByRef)).map(actionDefinition);
  },

  /**
   * The workflow builder's catalog in one read. A webhook trigger is fired by
   * its module's handler, so nothing binds to it and it is left out.
   */
  async getWorkflowCatalog(): Promise<WorkflowCatalog> {
    const [triggers, actions, modules] = await Promise.all([
      this.db.listTriggers(),
      this.db.listActions(),
      this.db.listModules(),
    ]);
    return {
      triggers: triggers.map(triggerDefinition).filter((trigger) => trigger.transport !== WEBHOOK_TRANSPORT),
      actions: actions.map(actionDefinition),
      functions: availableFunctions(modules),
    };
  },
});
