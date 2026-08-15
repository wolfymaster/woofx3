import { engineRoutes } from "./engine";
import { subscriptionsRoutes } from "./subscriptions";
import { triggerSubscriptionRoutes } from "./trigger-subscription";
import { workflowsExecutionRoutes } from "./workflows-execution";
import { commandsRoutes } from "./commands";
import { groupsRoutes } from "./groups";
import { fieldOptionsRoutes } from "./field-options";
import { userActionsRoutes } from "./user-actions";
import { eventsRoutes } from "./events";
import { dashboardRoutes } from "./dashboard";
import { accountsRoutes } from "./accounts";
import { modulesRoutes } from "./modules";
import { workflowsRoutes } from "./workflows";
import { scenesRoutes } from "./scenes";
import { dashboardStatsRoutes } from "./dashboard-stats";
import { triggersRoutes } from "./triggers";
import { alertsRoutes } from "./alerts";
import { overlayTokenRoutes } from "./overlay-tokens";
import type { ApiRouteHost } from "./context";

export type RegisteredApiRoutes = typeof engineRoutes &
  typeof subscriptionsRoutes &
  typeof triggerSubscriptionRoutes &
  typeof workflowsExecutionRoutes &
  typeof commandsRoutes &
  typeof groupsRoutes &
  typeof fieldOptionsRoutes &
  typeof userActionsRoutes &
  typeof eventsRoutes &
  typeof dashboardRoutes &
  typeof accountsRoutes &
  typeof modulesRoutes &
  typeof workflowsRoutes &
  typeof scenesRoutes &
  typeof dashboardStatsRoutes &
  typeof triggersRoutes &
  typeof alertsRoutes &
  typeof overlayTokenRoutes;

export function registerAllRoutes(host: ApiRouteHost): void {
  Object.assign(host, engineRoutes, subscriptionsRoutes, triggerSubscriptionRoutes, workflowsExecutionRoutes, commandsRoutes, groupsRoutes, fieldOptionsRoutes, userActionsRoutes, eventsRoutes, dashboardRoutes, accountsRoutes, modulesRoutes, workflowsRoutes, scenesRoutes, dashboardStatsRoutes, triggersRoutes, alertsRoutes, overlayTokenRoutes);
}
