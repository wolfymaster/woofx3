import type { RelayConfig } from "@woofx3/api";
import { parseRelayConfig } from "@woofx3/common/cloudevents/Relay/relay";
import { routeModule } from "./context";

export const relayRoutes = routeModule({
  /**
   * Route the listed local endpoints through the companion's bridge, or stop.
   * Stored with the calling dashboard's client id (`context.clientId`, the
   * session's), which is the one asked for bridge credentials
   * (`RelayCredentialSource`).
   */
  async setRelayConfig(config: RelayConfig | null, context?: { clientId: string }): Promise<{ ok: true }> {
    if (config === null) {
      await this.relayCredential.setConfig(null);
      return { ok: true };
    }
    const clientId = context?.clientId;
    if (!clientId) {
      throw new Error("setRelayConfig needs the session's client id to ask for bridge credentials");
    }
    const parsed = parseRelayConfig(config);
    await this.relayCredential.setConfig({ ...parsed, clientId });
    this.logger.info("Relay configuration stored", {
      bridgeOrigin: parsed.bridgeOrigin,
      endpoints: parsed.endpoints.length,
    });
    return { ok: true };
  },
});
