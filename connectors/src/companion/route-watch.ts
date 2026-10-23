// Tells an endpoint's listeners to reconnect when its route may have moved:
// the relay configuration changed in a way that moves it, or a setting of the
// module that declares it was written. Routes are read afresh on every
// connect, so a reconnect is all a listener needs to do.

import type { EngineHosting, RelayConfig } from "@woofx3/api";
import { RELAY_CONFIG_UPDATED_SUBJECT, routesEndpoint } from "@woofx3/common/cloudevents/Relay/relay";
import { errorMessage, type Logger } from "../host/deps";
import type { BusMessage, ScopedBus } from "../host/scoped-bus";
import { endpointKey } from "./claims";
import type { EndpointRoute, LocalEndpointRef, RouteChangeListener } from "./types";

/** db-proxy announces every module setting write here, naming the module and key but never the value. */
export const MODULE_SETTING_UPDATED_SUBJECT = "db.module.setting.updated.*";

/** What the route watch subscribes to on the host scope. */
export const ROUTE_WATCH_SUBJECTS = [RELAY_CONFIG_UPDATED_SUBJECT, MODULE_SETTING_UPDATED_SUBJECT] as const;

/** Where the latest attempt for an endpoint went. */
export interface LastRoute {
  route: EndpointRoute;
  address: string;
}

export interface RouteWatchDeps {
  relayConfig(): Promise<RelayConfig | null>;
  /** The endpoint's latest route, or null before its first resolution. */
  lastRoute(ref: LocalEndpointRef): LastRoute | null;
  hosting: EngineHosting | null;
  logger: Logger;
}

interface Watched {
  ref: LocalEndpointRef;
  listeners: Set<RouteChangeListener>;
}

const decoder = new TextDecoder();

export class RouteWatch {
  private readonly watched = new Map<string, Watched>();

  constructor(private readonly deps: RouteWatchDeps) {}

  /** Adds a listener for the endpoint. Returns the unsubscribe. */
  listen(ref: LocalEndpointRef, listener: RouteChangeListener): () => void {
    const key = endpointKey(ref);
    let entry = this.watched.get(key);
    if (entry === undefined) {
      entry = { ref: { moduleId: ref.moduleId, endpointId: ref.endpointId }, listeners: new Set() };
      this.watched.set(key, entry);
    }
    const listeners = entry.listeners;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && this.watched.get(key)?.listeners === listeners) {
        this.watched.delete(key);
      }
    };
  }

  async subscribe(scope: Pick<ScopedBus, "subscribe">): Promise<void> {
    await scope.subscribe(RELAY_CONFIG_UPDATED_SUBJECT, () => this.relayConfigUpdated());
    await scope.subscribe(MODULE_SETTING_UPDATED_SUBJECT, (msg) => {
      this.moduleSettingUpdated(msg);
    });
  }

  /**
   * Re-reads the relay configuration and tells each endpoint it moves. A
   * `local` engine never takes the bridge, so nothing moves there. A
   * configuration that cannot be read is assumed to move every endpoint.
   */
  async relayConfigUpdated(): Promise<void> {
    if (this.deps.hosting === "local" || this.watched.size === 0) {
      return;
    }
    let config: RelayConfig | null;
    try {
      config = await this.deps.relayConfig();
    } catch (error) {
      this.deps.logger.warn(
        "relay config change: could not read where endpoints are reached; reconnecting to be sure",
        {
          error: errorMessage(error),
        }
      );
      this.notifyAll(() => true, "Relay configuration changed");
      return;
    }
    this.notifyAll(
      (ref) => relayChangeMovesEndpoint(config, ref, this.deps.lastRoute(ref)),
      "Relay configuration changed"
    );
  }

  /** A write to a module's settings may change any endpoint it declares. */
  moduleSettingUpdated(msg: BusMessage): void {
    let moduleId: unknown;
    try {
      moduleId = (JSON.parse(decoder.decode(msg.data)) as { data?: { moduleId?: unknown } } | null)?.data?.moduleId;
    } catch (error) {
      this.deps.logger.warn(`${msg.subject}: malformed JSON body; dropped`, { error: errorMessage(error) });
      return;
    }
    if (typeof moduleId !== "string") {
      return;
    }
    this.notifyAll((ref) => ref.moduleId === moduleId, `${moduleId} settings changed`);
  }

  /** Calls every listener of each matching endpoint; one listener throwing never stops the others. */
  private notifyAll(matches: (ref: LocalEndpointRef) => boolean, why: string): void {
    for (const [key, { ref, listeners }] of this.watched) {
      if (!matches(ref)) {
        continue;
      }
      for (const listener of [...listeners]) {
        try {
          listener(why);
        } catch (error) {
          this.deps.logger.warn(`a route change listener for ${key} threw`, { error: errorMessage(error) });
        }
      }
    }
  }
}

/**
 * True when a relay configuration moves the endpoint off the route the
 * latest attempt took, so the open session should be replaced. With no
 * attempt yet, the one in flight may have read the old configuration.
 */
export function relayChangeMovesEndpoint(
  config: RelayConfig | null,
  ref: LocalEndpointRef,
  last: LastRoute | null
): boolean {
  if (last === null) {
    return true;
  }
  if (!config || !routesEndpoint(config, ref.moduleId, ref.endpointId)) {
    return last.route === "companion";
  }
  return last.route !== "companion" || new URL(config.bridgeOrigin).host !== last.address;
}
