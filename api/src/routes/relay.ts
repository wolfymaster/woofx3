import type { RelayConfig } from "@woofx3/api";
import {
  COMPANION_RELAY_CONFIG_SET_SUBJECT,
  parseRelayConfig,
  parseRelayConfigSetReply,
  type StoredRelayConfig,
} from "@woofx3/common/cloudevents/Relay/relay";
import type NATSClient from "@woofx3/nats/src/client";
import { routeModule } from "./context";

export const relayRoutes = routeModule({
  /**
   * Route the listed local endpoints through the companion's bridge, or stop.
   * Stored with the calling dashboard's client id (`context.clientId`, the
   * session's), which is the one asked for bridge credentials. The connectors
   * host's companion gateway stores it; this checks it and forwards it.
   *
   * Fails while that gateway is down. The dashboard's syncEngine retries, and
   * the gateway's next credential renewal applies the dashboard's
   * configuration anyway, so a missed call heals.
   */
  async setRelayConfig(config: RelayConfig | null, context?: { clientId: string }): Promise<{ ok: true }> {
    let stored: StoredRelayConfig | null = null;
    if (config !== null) {
      const clientId = context?.clientId;
      if (!clientId) {
        throw new Error("setRelayConfig needs the session's client id to ask for bridge credentials");
      }
      const parsed = parseRelayConfig(config);
      if (!parsed.ok) {
        throw new Error(parsed.error);
      }
      stored = { ...parsed.value, clientId };
    }
    await forwardRelayConfig(this.nats, stored, this.companionRequestTimeoutMs);
    if (stored === null) {
      this.logger.info("Relay configuration cleared");
    } else {
      this.logger.info("Relay configuration stored", {
        bridgeOrigin: stored.bridgeOrigin,
        endpoints: stored.endpoints.length,
      });
    }
    return { ok: true };
  },
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Asks the companion gateway to store the configuration, or clear it (null),
 * and waits until it has. Throws naming why when it did not: no bus, no
 * responder, no answer in time, a malformed answer or a failed write.
 */
export async function forwardRelayConfig(
  nats: Pick<NATSClient, "request"> | null,
  config: StoredRelayConfig | null,
  timeoutMs: number
): Promise<void> {
  const notStored = (reason: string) =>
    new Error(`the engine's companion gateway did not store the relay configuration: ${reason}`);
  if (!nats) {
    throw notStored("the message bus is not connected");
  }
  let raw: Uint8Array;
  try {
    const reply = await nats.request(COMPANION_RELAY_CONFIG_SET_SUBJECT, encoder.encode(JSON.stringify({ config })), {
      timeout: timeoutMs,
    });
    raw = reply.data;
  } catch (err) {
    throw notStored(err instanceof Error ? err.message : String(err));
  }
  let body: unknown;
  try {
    body = JSON.parse(decoder.decode(raw));
  } catch {
    throw notStored("its reply is not JSON");
  }
  const reply = parseRelayConfigSetReply(body);
  if (!reply.ok) {
    throw notStored(`its reply is malformed: ${reply.error}`);
  }
  if (reply.value.status === "failed") {
    throw notStored(reply.value.error);
  }
}
