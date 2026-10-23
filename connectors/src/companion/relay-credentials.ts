import type { RelayConfig } from "@woofx3/api";
import type { RelayCredentialRequestedResponse } from "@woofx3/api/webhooks";
import {
  COMPANION_DASHBOARD_CREDENTIAL_SUBJECT,
  parseDashboardCredentialReply,
  type RelayGrant,
  type StoredRelayConfig,
  sameRelayConfig,
} from "@woofx3/common/cloudevents/Relay/relay";
import { type Clock, errorMessage } from "../host/deps";
import type { ScopedBus } from "../host/scoped-bus";
import type { EndpointStore } from "./endpoint-store";

/** A credential this close to its expiry is renewed before use. */
const EXPIRY_MARGIN_MS = 60_000;

/** How many times `current` starts over when the configuration changes under a renewal. */
const MAX_RENEWAL_ATTEMPTS = 3;

/** A dashboard's answer, with the client id of the dashboard that gave it. */
export interface DashboardAnswer {
  clientId: string;
  answer: RelayCredentialRequestedResponse;
}

export interface RelayCredentialSourceDeps {
  store: Pick<EndpointStore, "relayConfig" | "writeRelayConfig" | "clearRelayConfig">;
  /** Asks the dashboard that set the configuration for a credential. Rejects when no dashboard answered usably. */
  askDashboard(clientId: string): Promise<DashboardAnswer>;
  /** Told of every configuration this source stores or clears, once it is stored. */
  configChanged(config: RelayConfig | null): void;
  clock: Clock;
}

/** The configuration changed while a renewal was under way; its answer is for the old one. */
class StaleRenewal extends Error {}

const STOPPED_MESSAGE = "the relay credential source stopped";

/**
 * The bridge credential for the companion's relay, renewed through the
 * dashboard that set the relay configuration, and the one writer of that
 * configuration.
 *
 * The credential is short-lived and never stored: only the configuration is,
 * so a restarted engine knows from its own database to use the bridge and
 * asks for a fresh credential. The dashboard's answer is authoritative: one
 * saying nothing is routed through a companion clears the stored
 * configuration, and one naming another bridge, other endpoints or another
 * dashboard replaces it. That heals an engine that missed a `setRelayConfig`
 * while it was down.
 *
 * Both `setConfig` and a renewal's answer write the configuration, so every
 * write runs behind one lock, and `setConfig` bumps a generation a renewal
 * checks after each await. A renewal that started before a `setConfig`
 * neither writes nor caches what it got back. `stop` bumps it too, so a
 * renewal still waiting on the dashboard then writes nothing.
 */
export class RelayCredentialSource {
  private cached: RelayGrant | null = null;
  private pending: Promise<RelayGrant | null> | null = null;
  private generation = 0;
  private writes: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly deps: RelayCredentialSourceDeps) {}

  /**
   * The grant to dial with, or null when nothing routes through a companion.
   * `force` renews a credential that is still cached, for one the relay
   * refused. Concurrent callers share one renewal.
   */
  async current(force = false): Promise<RelayGrant | null> {
    for (let attempt = 1; ; attempt += 1) {
      this.assertRunning();
      if (!force && this.cached && this.cached.expiresAt - EXPIRY_MARGIN_MS > this.deps.clock.now()) {
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

  /** Store the dashboard's configuration, or clear it (null). */
  async setConfig(config: StoredRelayConfig | null): Promise<void> {
    this.assertRunning();
    await this.exclusive(async () => {
      this.assertRunning();
      this.generation += 1;
      this.cached = null;
      this.pending = null;
      await this.store(config);
    });
  }

  /**
   * Refuses every later `current` and `setConfig`, abandons the renewal in
   * flight before it writes, and resolves once the write already under way,
   * if any, has finished: nothing writes the configuration after that.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    this.generation += 1;
    this.cached = null;
    this.pending = null;
    await this.writes;
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
    const config = await this.deps.store.relayConfig();
    this.assertCurrent(generation);
    if (!config) {
      this.cached = null;
      return null;
    }
    const { clientId, answer } = await this.deps.askDashboard(config.clientId);
    return this.exclusive(async () => {
      this.assertCurrent(generation);
      if (answer.relay === null) {
        this.cached = null;
        await this.store(null);
        return null;
      }
      const { credential: _, expiresAt: __, ...answered } = answer.relay;
      if (clientId !== config.clientId || !sameRelayConfig(config, answered)) {
        await this.store({ ...answered, clientId });
      }
      this.assertCurrent(generation);
      this.cached = answer.relay;
      return answer.relay;
    });
  }

  /** Writes or clears the stored configuration, then tells the route watch. Runs only behind the lock. */
  private async store(config: StoredRelayConfig | null): Promise<void> {
    if (config) {
      await this.deps.store.writeRelayConfig(config);
    } else {
      await this.deps.store.clearRelayConfig();
    }
    this.deps.configChanged(config);
  }

  private assertRunning(): void {
    if (this.stopped) {
      throw new Error(STOPPED_MESSAGE);
    }
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

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Asks the api, the engine's one connection to its dashboard, to ask the
 * dashboard on `COMPANION_DASHBOARD_CREDENTIAL_SUBJECT`. Rejects naming why
 * when nothing answers, the reply is malformed or the api reports a failure.
 */
export function askDashboardOverBus(
  scope: () => Pick<ScopedBus, "request">,
  timeoutMs: number
): (clientId: string) => Promise<DashboardAnswer> {
  return async (clientId) => {
    const reply = await scope().request(
      COMPANION_DASHBOARD_CREDENTIAL_SUBJECT,
      encoder.encode(JSON.stringify({ clientId })),
      {
        timeout: timeoutMs,
      }
    );
    let body: unknown;
    try {
      body = JSON.parse(decoder.decode(reply.data));
    } catch (error) {
      throw new Error(`the api's dashboard credential reply is not JSON: ${errorMessage(error)}`);
    }
    const parsed = parseDashboardCredentialReply(body);
    if (!parsed.ok) {
      throw new Error(`the api's dashboard credential reply is malformed: ${parsed.error}`);
    }
    if (parsed.value.status === "failed") {
      throw new Error(`the api could not get a relay credential from the dashboard: ${parsed.value.error}`);
    }
    return { clientId: parsed.value.clientId, answer: parsed.value.answer };
  };
}
