// OBS as one unit: where to find it (directly or through the companion),
// the connection that keeps a session open, what the latest attempt looked
// like, and the overlay refreshes it owes. The OBS adapter creates one per
// run, starts it, and stops it when the run ends; its served subjects read
// the connection and status, and its subscriptions ask it to reconnect.

import type { RelayConfig } from "@woofx3/api";
import { relayChangeMovesEndpoint } from "../../companion/route-watch";
import type { EndpointResolution } from "../../companion/types";
import type { ObsConnectionConfig } from "../../config/obs";
import type { Logger, RandomSource, Timers } from "../../host/deps";
import { ObsConnection, ObsRouteUnavailable } from "./connection";
import type Manager from "./manager";
import type { RefreshLatch } from "./refresh-latch";
import { refreshOverlayBrowserSources } from "./refresh-overlays";
import { OBS_ENDPOINT, openObsOverRoute } from "./settings";
import { type ObsLastRoute, type ObsStatusReply, obsStatusReply } from "./status";

export interface ObsServiceDeps {
  /** The route for one connect attempt, from the companion gateway; read afresh each time. */
  resolve(signal: AbortSignal): Promise<EndpointResolution>;
  /** The stored relay configuration, to tell whether a change to it moves OBS. */
  relayConfig(): Promise<RelayConfig | null>;
  /** The overlay refresh sceneManager asked for; outlives this service. */
  latch: RefreshLatch;
  connection: ObsConnectionConfig;
  random: RandomSource;
  timers: Timers;
  logger: Logger;
}

export interface ObsService {
  /** The connection to OBS: its current session, and the controls the adapter uses. */
  readonly connection: ObsConnection<Manager>;
  /** The connection's state for `engine.obs.status`, without touching OBS. */
  status(): ObsStatusReply;
  /** Whether the stored relay configuration moves OBS off the route its latest attempt took. */
  relayConfigMovesObs(): Promise<boolean>;
  /**
   * Starts connecting in the background and acts on the latched refresh on
   * the current or next session, and on every request latched until stop.
   * `signal` aborting stops the connection, as the adapter's start signal does
   * when the host gives up on the run.
   */
  start(signal: AbortSignal): void;
  stop(): Promise<void>;
}

export function createObsService(deps: ObsServiceDeps): ObsService {
  const { latch, logger } = deps;
  // Where and how the latest attempt looked for OBS, for the status reply.
  // The password and any bridge ticket stay inside the attempt.
  let last: ObsLastRoute | null = null;
  let stopListening: (() => void) | null = null;

  const refreshes = new RefreshDrain(latch, () => connection.current(), logger);
  const connection: ObsConnection<Manager> = new ObsConnection<Manager>({
    open: async (signal) => {
      const resolution = await deps.resolve(signal);
      signal.throwIfAborted();
      if (!resolution.ok) {
        if (resolution.address !== undefined) {
          last = { route: "companion", address: resolution.address };
        }
        throw new ObsRouteUnavailable(resolution.reason, resolution.message, resolution.address);
      }
      last = { route: resolution.route, address: resolution.address };
      try {
        return await openObsOverRoute(resolution, {
          connectTimeoutMs: deps.connection.connectTimeoutMs,
          timers: deps.timers,
          signal,
        });
      } catch (err) {
        if (err instanceof ObsRouteUnavailable && err.address !== undefined) {
          last = { route: "companion", address: err.address };
        }
        throw err;
      }
    },
    onConnected: () => refreshes.drain(),
    logger,
    config: deps.connection,
    random: deps.random,
    timers: deps.timers,
  });

  return {
    connection,
    status: () => obsStatusReply(connection, last),
    relayConfigMovesObs: async () => relayChangeMovesEndpoint(await deps.relayConfig(), OBS_ENDPOINT, last),
    start: (signal) => {
      stopListening = latch.onLatched(() => {
        void refreshes.drain();
      });
      connection.start(signal);
      void refreshes.drain();
    },
    stop: async () => {
      stopListening?.();
      stopListening = null;
      await connection.stop();
    },
  };
}

/**
 * Carries latched refresh requests to OBS, one at a time, on whichever
 * session is open at each step. With no session, or when OBS could not be
 * asked, the request goes back to the latch for the next session.
 */
class RefreshDrain {
  private draining = false;
  /** A request was latched while a drain ran, so the drain looks again before it ends. */
  private again = false;

  constructor(
    private readonly latch: RefreshLatch,
    private readonly session: () => Manager | null,
    private readonly logger: Logger
  ) {}

  async drain(): Promise<void> {
    if (this.draining) {
      this.again = true;
      return;
    }
    this.draining = true;
    try {
      do {
        this.again = false;
        if (!(await this.drainOnce())) {
          return;
        }
      } while (this.again);
    } finally {
      this.draining = false;
    }
  }

  /** False when OBS could not be asked, so the drain waits for the next session instead of looking again. */
  private async drainOnce(): Promise<boolean> {
    for (let client = this.session(); client; client = this.session()) {
      const request = this.latch.take();
      if (request === null) {
        return true;
      }
      let refreshed: number | null = null;
      try {
        refreshed = await refreshOverlayBrowserSources(client, request.overlayPort, this.logger);
      } finally {
        if (refreshed === null) {
          this.latch.release(request);
        } else {
          this.latch.consume(request);
        }
      }
      if (refreshed === null) {
        return false;
      }
    }
    return true;
  }
}
