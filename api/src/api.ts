import type { EventLogSelectionSource } from "./event-log-selection";
import { type RegisteredApiRoutes, registerAllRoutes } from "./routes";
import { type ApiOptions, ApiRouteHost } from "./routes/context";
import type { StreamEventBroadcaster } from "./stream-event-broadcaster";
import type { WebhookClient } from "./webhook-client";

export { readModuleCatalogFields } from "./routes/helpers";
export type { UninstallModuleResponse } from "./routes/types";
export type { ApiOptions };

/**
 * UI-focused API exposed via capnweb.
 * Route handlers live under `routes/` and are registered onto the
 * prototype below (once, at module load) rather than per-instance —
 * capnweb only exposes RpcTarget methods declared on the prototype
 * chain, and `api-session.ts` discovers delegate methods the same way
 * (`Object.getOwnPropertyNames(Api.prototype)`). Assigning them in the
 * constructor instead makes them instance properties, which are
 * invisible to both.
 */
/**
 * Declaration merging is what tells the type system about the methods
 * `registerAllRoutes` installs on the prototype below. Without it the class
 * body is all TypeScript sees, so `implements Woofx3EngineApi` reported the
 * whole contract as missing and every caller of a route method -- including
 * `application.ts` and `api-session.ts` -- fell back to `any`.
 */
export interface Api extends RegisteredApiRoutes {}

/**
 * Note this does not declare `implements Woofx3EngineApi`. That contract
 * describes the surface a *client* sees, which is `ApiSession`, not this
 * class: the methods `ApiSession` writes out by hand (installModuleZip,
 * installMarketplaceListing, uninstallModule and the rest) take an extra
 * `context` argument here that it fills in from the authenticated session
 * rather than from the caller.
 */
export class Api extends ApiRouteHost {
  constructor(opts: ApiOptions) {
    super(opts);
  }

  setWebhookClient(client: WebhookClient): void {
    this.webhookClient = client;
  }

  setAuthInvalidate(fn: () => void): void {
    this.authInvalidate = fn;
  }

  setStreamEventBroadcaster(broadcaster: StreamEventBroadcaster): void {
    this.streamEventBroadcaster = broadcaster;
  }

  setEventLogSelectionSource(source: EventLogSelectionSource): void {
    this.eventLogSelection = source;
  }
}

registerAllRoutes(Api.prototype);
