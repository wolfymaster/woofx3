import type { RunActionsInput } from "@woofx3/api";
import { routeModule } from "./context";

export const actionsRoutes = routeModule({
  /**
   * Run actions that belong to no workflow.
   *
   * Published rather than executed here: the workflow engine owns execution,
   * and it is the only process holding the action handlers. What comes back is
   * the correlation handle, not an outcome — the run starts after this call
   * has returned, the same as every other trigger.
   */
  async runActions(input: RunActionsInput): Promise<{ requested: true; triggerId: string }> {
    if (!Array.isArray(input?.actions) || input.actions.length === 0) {
      throw new Error("runActions: at least one action is required");
    }
    for (const [index, action] of input.actions.entries()) {
      if (!action?.action) {
        throw new Error(`runActions: action ${index + 1} names no handler`);
      }
    }

    const triggerId = input.triggerId || crypto.randomUUID();
    const label = input.label || "actions";

    // The event the actions resolve `${trigger.data...}` against. Built here
    // when the caller supplied none, so an action list that references nothing
    // still runs rather than failing on a missing event.
    const event = {
      id: crypto.randomUUID(),
      type: input.event?.type ?? "action.run",
      source: input.event?.source ?? "api",
      time: new Date().toISOString(),
      data: input.event?.data ?? {},
    };

    await this.publishEvent("action.execute", { label, actions: input.actions, event }, undefined, undefined, "api", {
      triggerId,
    });

    this.logger.info("Action run requested", { label, actions: input.actions.length, triggerId });
    return { requested: true, triggerId };
  },
});
