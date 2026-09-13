import { routeModule } from "./context";
import type { ActionDefinition, TriggerDefinition } from "@woofx3/api/webhooks";

export const triggersRoutes = routeModule({
  async getTriggers(createdByType?: string, createdByRef?: string): Promise<TriggerDefinition[]> {
    const rows = await this.db.listTriggers(createdByType, createdByRef);
    // `handler` names a module function, which stays inside the engine.
    return rows.map(({ handler: _handler, ...definition }) => definition);
  },

  async getActions(createdByType?: string, createdByRef?: string): Promise<ActionDefinition[]> {
    const rows = await this.db.listActions(createdByType, createdByRef);
    return rows;
  },
});
