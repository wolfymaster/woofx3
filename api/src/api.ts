import type { WebhookClient } from "./webhook-client";
import { ApiRouteHost, type ApiOptions } from "./routes/context";
import { registerAllRoutes, type RegisteredApiRoutes } from "./routes";

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
 * class: six methods -- installModuleZip, installModuleFromUrl,
 * uninstallModule, uninstallEngineModule, createResourceInstance and
 * deleteResourceInstance -- take an extra `context` argument here that
 * `ApiSession` fills in from the authenticated session rather than from the
 * caller. Asserting the client contract on this class was incorrect; it went
 * unnoticed only because the route methods were invisible to the type system,
 * so the assertion failed wholesale on all 73 members instead of on the six
 * that genuinely differ.
 */
export class Api extends ApiRouteHost {
  constructor(opts: ApiOptions) {
    super(opts);
  }

  setWebhookClient(client: WebhookClient): void {
    this.webhookClient = client;
    if (this.applicationId) {
      client.setApplicationId(this.applicationId);
    }
  }

  setAuthInvalidate(fn: () => void): void {
    this.authInvalidate = fn;
  }

  setApplicationId(applicationId: string): void {
    this.applicationId = applicationId;
    if (this.webhookClient) {
      this.webhookClient.setApplicationId(applicationId);
    }
  }
}

registerAllRoutes(Api.prototype);
