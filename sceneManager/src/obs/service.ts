// OBS as one unit: where to find it (directly or through the companion),
// the connection that keeps a session open, what the latest attempt looked
// like, and the answers the rest of the service asks of it. The application
// creates it, starts it once the HTTP server listens, and stops it on
// shutdown; the bus subscriptions read its status and relay answers.

import type { Logger } from "@woofx3/common/runtime";
import {
  RELAY_CONFIG_SETTING,
  readStoredRelayConfig,
  requestRelayCredentialOverNats,
} from "@woofx3/common/cloudevents/Relay/relay";
import type NATSClient from "@woofx3/nats/src/client";
import type { SceneManagerRuntimeConfig } from "../config";
import type { DbClient } from "../db";
import {
  type DialerDeps,
  dialWebSocketEndpoint,
  EndpointRelayError,
  endpointKeysFromManifest,
  relayChangeMovesEndpoint,
} from "../endpoints/dialer";
import { ObsConnection } from "./connection";
import type Manager from "./manager";
import { refreshOverlayBrowserSources } from "./refresh-overlays";
import { obsDialTarget, openObsOverRoute } from "./settings";
import { type ObsLastRoute, type ObsStatusReply, obsStatusReply } from "./status";

export interface ObsServiceDeps {
  db: DbClient;
  /** The bus the api is asked for a relay credential on; null when there is none. */
  nats: Pick<NATSClient, "request"> | null;
  obs: SceneManagerRuntimeConfig["obs"];
  /** The HTTP port overlays are served on, for refreshing OBS browser sources showing them. */
  overlayPort: number;
  logger: Logger;
}

export interface ObsService {
  /** The connection to OBS: its current session, and the controls the bus subscriptions use. */
  readonly connection: ObsConnection<Manager>;
  /** The connection's state for `engine.obs.status`, without touching OBS. */
  status(): ObsStatusReply;
  /** Whether the stored relay configuration moves OBS off the route its latest attempt took. */
  relayConfigMovesObs(): Promise<boolean>;
  start(): void;
  stop(): Promise<void>;
}

export function createObsService(deps: ObsServiceDeps): ObsService {
  const { db, logger } = deps;
  const readRelayConfig = async () => readStoredRelayConfig(await db.getSetting(RELAY_CONFIG_SETTING));
  const bus = deps.nats;
  const requestRelayCredential = bus
    ? requestRelayCredentialOverNats((subject, data, opts) => bus.request(subject, data, opts))
    : null;
  const dialer: DialerDeps = {
    endpointKeys: async (moduleId, endpointId) =>
      endpointKeysFromManifest(await db.getModuleManifest(moduleId), endpointId),
    settings: (moduleId) => db.listModuleSettings(moduleId),
    secrets: (moduleId) => db.getModuleSecretValues(moduleId),
    // Read on every attempt, like the module settings, so a missed
    // `engine.relay.config.updated` is picked up on the next retry.
    relayConfig: readRelayConfig,
    relayCredential: async (force) => {
      if (!requestRelayCredential) {
        throw new Error("no message bus to ask the api for a relay credential");
      }
      return requestRelayCredential(force);
    },
    fetch: (url, init) => fetch(url, init),
    logger,
  };
  const target = obsDialTarget(deps.obs);
  // Where and how the latest attempt looked for OBS, for the status reply.
  // The password and any bridge ticket stay inside the attempt.
  let last: ObsLastRoute | null = null;

  const connection = new ObsConnection<Manager>({
    open: async () => {
      try {
        const route = await dialWebSocketEndpoint(dialer, target);
        last = { route: route.route, address: route.address };
        return await openObsOverRoute(route, logger);
      } catch (err) {
        if (err instanceof EndpointRelayError) {
          last = { route: "companion", address: err.address };
        }
        throw err;
      }
    },
    // Refresh overlays on the first session only. It exists to recover
    // overlays after *this process* restarted; after a mere reconnect their
    // streams are intact, and a refresh would cut off whatever is playing.
    onConnected: async (client, { first }) => {
      if (first) {
        await refreshOverlayBrowserSources(client, deps.overlayPort, logger);
      }
    },
    logger,
  });

  return {
    connection,
    status: () => obsStatusReply(connection, last),
    relayConfigMovesObs: async () => relayChangeMovesEndpoint(await readRelayConfig(), target, last),
    start: () => connection.start(),
    stop: () => connection.stop(),
  };
}
