import type { Woofx3EngineApi } from "@woofx3/api";
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
export class Api extends ApiRouteHost implements Woofx3EngineApi, RegisteredApiRoutes {
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
