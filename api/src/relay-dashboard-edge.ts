// The api's one part in the companion relay: asking the dashboard for a bridge
// credential on the connectors host's companion gateway's behalf. The api is
// the engine's one connection to its dashboard, so the gateway, which holds
// the relay configuration and caches the credential, asks here. Nothing is
// kept between requests.

import { EngineRequestType } from "@woofx3/api/webhooks";
import {
  COMPANION_DASHBOARD_CREDENTIAL_SUBJECT,
  type DashboardCredentialReply,
  parseDashboardCredentialRequest,
  parseRelayCredentialResponse,
} from "@woofx3/common/cloudevents/Relay/relay";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import type { DashboardRequester } from "./twitch-token-source";

/** The dashboards this engine is registered with; `WebhookClient` provides it. */
export interface RelayDashboard extends DashboardRequester {
  /** Engine client ids of the registered dashboards. */
  clientIds(): string[];
}

const encoder = new TextEncoder();

/**
 * The dashboard to ask: the one that set the configuration while it is still
 * registered. A dashboard that registered again has a new client id, and the
 * old one would otherwise be asked, and fail, forever.
 */
export function dashboardClientId(stored: string, registered: string[]): string {
  if (registered.includes(stored) || registered.length === 0) {
    return stored;
  }
  return registered[0] as string;
}

/** Asks the dashboard for a credential and checks its answer. Never throws: a failure is a `failed` reply. */
export async function askDashboardForRelayCredential(
  dashboard: RelayDashboard | null,
  body: unknown
): Promise<DashboardCredentialReply> {
  const request = parseDashboardCredentialRequest(body);
  if (!request.ok) {
    return { status: "failed", error: `invalid request: ${request.error}` };
  }
  if (!dashboard) {
    return { status: "failed", error: "no dashboard connection to ask for a relay credential" };
  }
  const clientId = dashboardClientId(request.value.clientId, dashboard.clientIds());
  try {
    const answer = parseRelayCredentialResponse(
      await dashboard.request({ type: EngineRequestType.RELAY_CREDENTIAL_REQUESTED }, clientId)
    );
    return { status: "answered", clientId, answer };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

/** Answers the companion gateway's requests on `COMPANION_DASHBOARD_CREDENTIAL_SUBJECT`. */
export async function serveDashboardRelayCredential(
  nats: NATSClient,
  dashboard: () => RelayDashboard | null,
  logger: SharedLogger
): Promise<void> {
  await nats.subscribe(COMPANION_DASHBOARD_CREDENTIAL_SUBJECT, async (msg: Msg) => {
    let body: unknown = null;
    try {
      body = msg.json();
    } catch {
      // A body that is not JSON is refused below as an invalid request.
    }
    const reply = await askDashboardForRelayCredential(dashboard(), body);
    if (reply.status === "failed") {
      logger.warn("relay credential request failed", { error: reply.error });
    }
    msg.respond(encoder.encode(JSON.stringify(reply)));
  });
}
