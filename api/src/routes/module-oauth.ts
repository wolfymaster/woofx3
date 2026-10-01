import type { ModuleOAuthAuthorization, ModuleOAuthConnected } from "@woofx3/api";
import { routeModule } from "./context";

export const moduleOAuthRoutes = routeModule({
  /**
   * Barkloader holds the module's integration and its settings, so it does
   * the exchange; this only carries the dashboard's request to it.
   */
  async completeModuleOAuth(
    moduleId: string,
    integration: string,
    authorization: ModuleOAuthAuthorization
  ): Promise<ModuleOAuthConnected> {
    const path = `/modules/${encodeURIComponent(moduleId)}/oauth/${encodeURIComponent(integration)}/complete`;
    const response = await fetch(`${this.getBarkloaderBaseUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authorization),
    });
    const body = (await response.json().catch(() => ({}))) as { scope?: unknown; error?: unknown };
    if (!response.ok) {
      throw new Error(typeof body.error === "string" ? body.error : `barkloader answered ${response.status}`);
    }
    const scope = Array.isArray(body.scope) ? body.scope.filter((s): s is string => typeof s === "string") : [];
    return { connected: true, scope };
  },
});
