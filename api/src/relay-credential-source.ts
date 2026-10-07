import { EngineRequestType, type RelayCredentialRequestedResponse } from "@woofx3/api/webhooks";
import {
  parseRelayGrant,
  RELAY_CREDENTIAL_SUBJECT,
  type RelayCredentialReply,
  type RelayGrant,
  type StoredRelayConfig,
  sameRelayConfig,
} from "@woofx3/common/cloudevents/Relay/relay";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import type { DashboardRequester } from "./twitch-token-source";

/** A credential this close to its expiry is renewed before use. */
const EXPIRY_MARGIN_MS = 60_000;

/** How many times `current` starts over when the configuration changes under a renewal. */
const MAX_RENEWAL_ATTEMPTS = 3;

/** The dashboards this engine is registered with; `WebhookClient` provides it. */
export interface RelayDashboard extends DashboardRequester {
  /** Engine client ids of the registered dashboards. */
  clientIds(): string[];
}

export interface RelayCredentialSourceDeps {
  dashboard(): RelayDashboard | null;
  readConfig(): Promise<StoredRelayConfig | null>;
  /** Store a configuration and announce it. */
  writeConfig(config: StoredRelayConfig): Promise<void>;
  /** Delete the stored configuration and announce it. */
  clearConfig(): Promise<void>;
  now(): number;
}

/** The configuration changed while a renewal was under way; its answer is for the old one. */
class StaleRenewal extends Error {}

/**
 * The bridge credential for the companion's relay, renewed through the
 * dashboard that set the relay configuration, and the one writer of that
 * configuration.
 *
 * The credential is short-lived and never stored: only the configuration is,
 * so a restarted engine knows from its own database to use the bridge and
 * asks for a fresh credential. The dashboard's answer is authoritative: one
 * saying nothing is routed through a companion clears the stored
 * configuration, and one naming another bridge or other endpoints replaces it.
 * That heals an engine that missed a `setRelayConfig` while it was down.
 *
 * Both `setConfig` and a renewal's answer write the configuration, so every
 * write runs behind one lock, and `setConfig` bumps a generation a renewal
 * checks after each await. A renewal that started before a `setConfig`
 * neither writes nor caches what it got back.
 */
export class RelayCredentialSource {
  private cached: RelayGrant | null = null;
  private pending: Promise<RelayGrant | null> | null = null;
  private generation = 0;
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly deps: RelayCredentialSourceDeps) {}

  /**
   * The grant to dial with, or null when nothing routes through a companion.
   * `force` renews a credential that is still cached, for one the relay
   * refused. Concurrent callers share one renewal.
   */
  async current(force = false): Promise<RelayGrant | null> {
    for (let attempt = 1; ; attempt += 1) {
      if (!force && this.cached && this.cached.expiresAt - EXPIRY_MARGIN_MS > this.deps.now()) {
        return this.cached;
      }
      try {
        return await this.renewal();
      } catch (err) {
        if (!(err instanceof StaleRenewal) || attempt >= MAX_RENEWAL_ATTEMPTS) {
          throw err;
        }
      }
    }
  }

  /** Store the dashboard's configuration, or clear it (null), and announce it. */
  async setConfig(config: StoredRelayConfig | null): Promise<void> {
    await this.exclusive(async () => {
      this.generation += 1;
      this.cached = null;
      this.pending = null;
      if (config) {
        await this.deps.writeConfig(config);
      } else {
        await this.deps.clearConfig();
      }
    });
  }

  private renewal(): Promise<RelayGrant | null> {
    if (!this.pending) {
      const pending = this.renew(this.generation).finally(() => {
        if (this.pending === pending) {
          this.pending = null;
        }
      });
      this.pending = pending;
    }
    return this.pending;
  }

  private async renew(generation: number): Promise<RelayGrant | null> {
    const config = await this.deps.readConfig();
    this.assertCurrent(generation);
    if (!config) {
      this.cached = null;
      return null;
    }
    const dashboard = this.deps.dashboard();
    if (!dashboard) {
      throw new Error("no dashboard connection to ask for a relay credential");
    }
    const clientId = dashboardClientId(config.clientId, dashboard.clientIds());
    const answer = parseRelayCredentialResponse(
      await dashboard.request({ type: EngineRequestType.RELAY_CREDENTIAL_REQUESTED }, clientId)
    );
    return this.exclusive(async () => {
      this.assertCurrent(generation);
      if (answer.relay === null) {
        this.cached = null;
        await this.deps.clearConfig();
        return null;
      }
      const { credential: _, expiresAt: __, ...answered } = answer.relay;
      if (clientId !== config.clientId || !sameRelayConfig(config, answered)) {
        await this.deps.writeConfig({ ...answered, clientId });
      }
      this.assertCurrent(generation);
      this.cached = answer.relay;
      return answer.relay;
    });
  }

  private assertCurrent(generation: number): void {
    if (generation !== this.generation) {
      throw new StaleRenewal("the relay configuration changed while a credential was requested");
    }
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.writes.then(work);
    this.writes = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

/**
 * The dashboard to ask: the one that set the configuration while it is still
 * registered. A dashboard that registered again has a new client id, and the
 * old one would otherwise be asked, and fail, forever.
 */
function dashboardClientId(stored: string, registered: string[]): string {
  if (registered.includes(stored) || registered.length === 0) {
    return stored;
  }
  return registered[0] as string;
}

/** The dashboard's answer to `relay.credential.requested`, refusing anything that is not one. */
export function parseRelayCredentialResponse(body: unknown): RelayCredentialRequestedResponse {
  if (typeof body !== "object" || body === null || !("relay" in body)) {
    throw new Error("the dashboard's answer has no relay field");
  }
  const { relay } = body as { relay: unknown };
  if (relay === null) {
    return { relay: null };
  }
  return { relay: parseRelayGrant(relay) };
}

/**
 * Answer the engine's other services' requests for the bridge credential on
 * `RELAY_CREDENTIAL_SUBJECT`. They never hold the dashboard's address or
 * credentials; the api is the one service that talks to the dashboard.
 */
export async function serveRelayCredential(
  nats: NATSClient,
  source: RelayCredentialSource,
  logger: SharedLogger
): Promise<void> {
  await nats.subscribe(RELAY_CREDENTIAL_SUBJECT, async (msg: Msg) => {
    let force = false;
    try {
      force = (msg.json() as { force?: unknown } | null)?.force === true;
    } catch {
      // An empty or non-JSON request asks for the current credential.
    }
    let reply: RelayCredentialReply;
    try {
      reply = { relay: await source.current(force) };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.warn("relay credential request failed", { error, force });
      reply = { error };
    }
    msg.respond(new TextEncoder().encode(JSON.stringify(reply)));
  });
}
