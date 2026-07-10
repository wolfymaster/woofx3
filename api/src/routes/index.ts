import { engineRoutes } from "./engine";
import { subscriptionsRoutes } from "./subscriptions";
import { triggerSubscriptionRoutes } from "./trigger-subscription";
import { workflowsExecutionRoutes } from "./workflows-execution";
import { commandsRoutes } from "./commands";
import { fieldOptionsRoutes } from "./field-options";
import { userActionsRoutes } from "./user-actions";
import { eventsRoutes } from "./events";
import { dashboardRoutes } from "./dashboard";
import { teamsRoutes } from "./teams";
import { accountsRoutes } from "./accounts";
import { modulesRoutes } from "./modules";
import { workflowsRoutes } from "./workflows";
import { assetsRoutes } from "./assets";
import { scenesRoutes } from "./scenes";
import { dashboardStatsRoutes } from "./dashboard-stats";
import { chatRoutes } from "./chat";
import { triggersRoutes } from "./triggers";
import { preferencesRoutes } from "./preferences";
import { dashboardLayoutRoutes } from "./dashboard-layout";
import { alertsRoutes } from "./alerts";
import type { ApiRouteHost } from "./context";

export type RegisteredApiRoutes = typeof engineRoutes &
  typeof subscriptionsRoutes &
  typeof triggerSubscriptionRoutes &
  typeof workflowsExecutionRoutes &
  typeof commandsRoutes &
  typeof fieldOptionsRoutes &
  typeof userActionsRoutes &
  typeof eventsRoutes &
  typeof dashboardRoutes &
  typeof teamsRoutes &
  typeof accountsRoutes &
  typeof modulesRoutes &
  typeof workflowsRoutes &
  typeof assetsRoutes &
  typeof scenesRoutes &
  typeof dashboardStatsRoutes &
  typeof chatRoutes &
  typeof triggersRoutes &
  typeof preferencesRoutes &
  typeof dashboardLayoutRoutes &
  typeof alertsRoutes;

export function registerAllRoutes(host: ApiRouteHost): void {
  Object.assign(host, engineRoutes, subscriptionsRoutes, triggerSubscriptionRoutes, workflowsExecutionRoutes, commandsRoutes, fieldOptionsRoutes, userActionsRoutes, eventsRoutes, dashboardRoutes, teamsRoutes, accountsRoutes, modulesRoutes, workflowsRoutes, assetsRoutes, scenesRoutes, dashboardStatsRoutes, chatRoutes, triggersRoutes, preferencesRoutes, dashboardLayoutRoutes, alertsRoutes);
}
