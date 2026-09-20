import { routeModule } from "./context";
import type { ActionDefinition, TriggerDefinition } from "@woofx3/api/webhooks";

/**
 * The key the registration webhook gives a module trigger (the db's
 * `projectionKeyFor`). The UI identifies triggers by it, so a listing without
 * it reads to the UI as triggers it cannot place — and its sync then takes
 * every webhook endpoint for gone. Empty for a trigger no module owns.
 */
export function triggerProjectionKey(trigger: {
  createdByType: string;
  createdByRef: string;
  manifestId: string;
}): string {
  if (trigger.createdByType !== "MODULE" || !trigger.createdByRef || !trigger.manifestId) {
    return "";
  }
  return `${trigger.createdByRef}:trigger:${trigger.manifestId}`;
}

export const triggersRoutes = routeModule({
  async getTriggers(createdByType?: string, createdByRef?: string): Promise<TriggerDefinition[]> {
    const rows = await this.db.listTriggers(createdByType, createdByRef);
    // `handler` names a module function, which stays inside the engine. An
    // empty `sentence` is the column default, not a declared template.
    return rows.map(({ handler: _handler, sentence, ...rest }) => {
      const definition = sentence ? { ...rest, sentence } : rest;
      const projectionKey = triggerProjectionKey(definition);
      return projectionKey ? { ...definition, projectionKey } : definition;
    });
  },

  async getActions(createdByType?: string, createdByRef?: string): Promise<ActionDefinition[]> {
    const rows = await this.db.listActions(createdByType, createdByRef);
    return rows;
  },
});
