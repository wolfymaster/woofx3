import { SpanKind, withSpan } from "@woofx3/common/logging";
import { accountsRoutes } from "./accounts";
import { actionsRoutes } from "./actions";
import { alertsRoutes } from "./alerts";
import { analyticsRoutes } from "./analytics";
import { commandsRoutes } from "./commands";
import { configBundlesRoutes } from "./config-bundles";
import type { ApiRouteHost } from "./context";
import { dashboardRoutes } from "./dashboard";
import { dashboardStatsRoutes } from "./dashboard-stats";
import { engineRoutes } from "./engine";
import { eventsRoutes } from "./events";
import { fieldOptionsRoutes } from "./field-options";
import { groupsRoutes } from "./groups";
import { inboundWebhooksRoutes } from "./inbound-webhooks";
import { moduleOAuthRoutes } from "./module-oauth";
import { modulesRoutes } from "./modules";
import { obsRoutes } from "./obs";
import { overlayTokenRoutes } from "./overlay-tokens";
import { resourcesRoutes } from "./resources";
import { scenesRoutes } from "./scenes";
import { streamEventsRoutes } from "./stream-events";
import { streamSessionsRoutes } from "./stream-sessions";
import { subscriptionsRoutes } from "./subscriptions";
import { triggerSubscriptionRoutes } from "./trigger-subscription";
import { triggersRoutes } from "./triggers";
import { userActionsRoutes } from "./user-actions";
import { workflowsRoutes } from "./workflows";
import { workflowsExecutionRoutes } from "./workflows-execution";

export type RegisteredApiRoutes = typeof engineRoutes &
  typeof subscriptionsRoutes &
  typeof triggerSubscriptionRoutes &
  typeof streamEventsRoutes &
  typeof workflowsExecutionRoutes &
  typeof actionsRoutes &
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
  typeof obsRoutes &
  typeof overlayTokenRoutes &
  typeof resourcesRoutes &
  typeof inboundWebhooksRoutes &
  typeof streamSessionsRoutes &
  typeof analyticsRoutes &
  typeof configBundlesRoutes &
  typeof moduleOAuthRoutes;

type RouteMethod = (this: ApiRouteHost, ...args: unknown[]) => unknown;

/**
 * Wraps every capnweb route method in a span. Applying it once here, at
 * registration, keeps all 18 route modules free of telemetry boilerplate and
 * guarantees a new route is instrumented the moment it is registered.
 * `withSpan` is a pass-through while tracing is disabled.
 */
function instrumentRoutes<T extends Record<string, unknown>>(routes: T): T {
  const instrumented: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(routes)) {
    if (typeof value !== "function") {
      instrumented[name] = value;
      continue;
    }
    const method = value as RouteMethod;
    instrumented[name] = function instrumentedRoute(this: ApiRouteHost, ...args: unknown[]): Promise<unknown> {
      return withSpan(`api.${name}`, () => method.apply(this, args), {
        attributes: { "rpc.method": name, "rpc.system": "capnweb" },
        kind: SpanKind.SERVER,
      });
    };
  }
  return instrumented as T;
}

export function registerAllRoutes(host: ApiRouteHost): void {
  Object.assign(
    host,
    instrumentRoutes(engineRoutes),
    instrumentRoutes(subscriptionsRoutes),
    instrumentRoutes(triggerSubscriptionRoutes),
    instrumentRoutes(streamEventsRoutes),
    instrumentRoutes(workflowsExecutionRoutes),
    instrumentRoutes(commandsRoutes),
    instrumentRoutes(groupsRoutes),
    instrumentRoutes(actionsRoutes),
    instrumentRoutes(fieldOptionsRoutes),
    instrumentRoutes(userActionsRoutes),
    instrumentRoutes(eventsRoutes),
    instrumentRoutes(dashboardRoutes),
    instrumentRoutes(accountsRoutes),
    instrumentRoutes(modulesRoutes),
    instrumentRoutes(workflowsRoutes),
    instrumentRoutes(scenesRoutes),
    instrumentRoutes(dashboardStatsRoutes),
    instrumentRoutes(triggersRoutes),
    instrumentRoutes(alertsRoutes),
    instrumentRoutes(obsRoutes),
    instrumentRoutes(overlayTokenRoutes),
    instrumentRoutes(resourcesRoutes),
    instrumentRoutes(inboundWebhooksRoutes),
    instrumentRoutes(streamSessionsRoutes),
    instrumentRoutes(analyticsRoutes),
    instrumentRoutes(configBundlesRoutes),
    instrumentRoutes(moduleOAuthRoutes)
  );
}
