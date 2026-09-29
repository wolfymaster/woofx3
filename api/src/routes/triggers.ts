import type { ActionDefinition, TriggerDefinition } from "@woofx3/api/webhooks";
import { routeModule } from "./context";

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

export const triggersRoutes = routeModule({
  async getTriggers(createdByType?: string, createdByRef?: string): Promise<TriggerDefinition[]> {
    const rows = await this.db.listTriggers(createdByType, createdByRef);
    // `handler` names a module function, which stays inside the engine. An
    // empty `sentence` is the column default, not a declared template.
    return rows.map(({ handler: _handler, sentence, ...rest }) => {
      const definition = sentence ? { ...rest, sentence } : rest;
      const projectionKey = moduleProjectionKey(definition, "trigger");
      return projectionKey ? { ...definition, projectionKey } : definition;
    });
  },

  async getActions(createdByType?: string, createdByRef?: string): Promise<ActionDefinition[]> {
    const rows = await this.db.listActions(createdByType, createdByRef);
    return rows.map((row) => {
      const projectionKey = moduleProjectionKey(row, "action");
      return projectionKey ? { ...row, projectionKey } : row;
    });
  },
});
