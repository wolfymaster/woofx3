import { SpanKind, withSpan } from "@woofx3/common/logging";
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
    instrumentRoutes(workflowsExecutionRoutes),
    instrumentRoutes(commandsRoutes),
    instrumentRoutes(groupsRoutes),
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
    instrumentRoutes(overlayTokenRoutes)
  );
}
