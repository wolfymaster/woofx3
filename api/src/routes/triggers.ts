import type { ActionDefinition, TriggerDefinition } from "@woofx3/api/webhooks";
import { ApiRouteHost } from "./context";

export const triggersRoutes = {
  async getTriggers(createdByType?: string, createdByRef?: string): Promise<TriggerDefinition[]> {
    // Proto Trigger and TriggerDefinition are structurally identical
    // (camelCase field names introduced by twirpscript), so the conversion
    // is a no-op cast — kept explicit so the contract / impl stay tied
    // through the type checker.
    const rows = await this.db.listTriggers(createdByType, createdByRef);
    return rows;
  },

  async getActions(createdByType?: string, createdByRef?: string): Promise<ActionDefinition[]> {
    const rows = await this.db.listActions(createdByType, createdByRef);
    return rows;
  },
};
