// Picks how connectors reaches a local endpoint for one connect attempt:
// straight to the address the route policy allows, or through the
// companion's bridge when the dashboard routed that endpoint there. The
// companion owns the actual address on the streamer's network, so the bridge
// path names the endpoint, never a host. See docs/services/companion-gateway.md.

import type { EngineHosting, RelayConfig } from "@woofx3/api";
import { type RelayGrant, routesEndpoint } from "@woofx3/common/cloudevents/Relay/relay";
import { RELAY_TICKET_TTL_MS } from "../config/companion";
import { errorMessage, type Logger, type TimerHandle, type Timers } from "../host/deps";
import { abortable } from "./abortable";
import type { BridgeOpenPermit, BridgeOpens } from "./bridge-opens";
import { endpointKey } from "./claims";
import type { DirectDecision, RoutePolicy } from "./route-policy";
import type {
  EndpointResolution,
  EndpointUnavailable,
  EndpointUnavailableReason,
  LocalEndpointRef,
  ResolveOptions,
} from "./types";

export type Fetch = (url: URL, init: RequestInit) => Promise<Response>;

export interface DialerDeps {
  relayConfig(): Promise<RelayConfig | null>;
  /**
   * The bridge credential, or null when nothing routes through a companion.
   * `force` asks for a fresh one in place of a cached one. Throws when none can be had.
   */
  relayCredential(force: boolean): Promise<RelayGrant | null>;
  fetch: Fetch;
  opens: BridgeOpens;
  hosting: EngineHosting | null;
  ticketTimeoutMs: number;
  timers: Timers;
  logger: Logger;
}

const TICKET = /^[A-Za-z0-9_-]{43}$/;

/**
 * Refusals about the endpoint itself rather than its address. No route can
 * fix them, so the bridge is never tried; the other refusals only mean there
 * is no direct route, which the bridge may still provide.
 */
const ENDPOINT_REFUSALS: ReadonlySet<EndpointUnavailableReason> = new Set([
  "not_declared",
  "adapter_owned",
  "protocol_unsupported",
  "store_unreadable",
]);

type TicketOutcome =
  | { kind: "ticket"; ticket: string; expiresInMs: number }
  | { kind: "refused"; status: number }
  | { kind: "failed"; message: string };

/** A permit held until its ticket expires, so stop can release it early. */
interface HeldPermit {
  permit: BridgeOpenPermit;
  timer: TimerHandle;
}

export class EndpointDialer {
  /** Endpoints a `local` engine has already warned about finding in the relay configuration. */
  private readonly warnedLocal = new Set<string>();
  private readonly held = new Set<HeldPermit>();

  constructor(private readonly deps: DialerDeps) {}

  /**
   * The route for one connect attempt. Everything is read afresh each time,
   * so a retry picks up a change whose announcement was missed, and every
   * bridge attempt gets a fresh ticket: a ticket is single-use, spent even
   * when the upgrade it was presented on is refused. Rejects only when
   * `opts.signal` aborts.
   */
  async dial(policy: RoutePolicy, ref: LocalEndpointRef, opts: ResolveOptions): Promise<EndpointResolution> {
    const { signal } = opts;
    signal.throwIfAborted();
    const direct = await abortable(policy.direct(ref, opts.fallback), signal);
    if (!direct.ok && ENDPOINT_REFUSALS.has(direct.reason)) {
      return direct;
    }
    let config: RelayConfig | null;
    try {
      config = await abortable(this.deps.relayConfig(), signal);
    } catch (error) {
      signal.throwIfAborted();
      if (policy.directWithoutRelayConfig && (this.deps.hosting === "local" || direct.ok)) {
        // Only the bridge needs the relay configuration; an engine that cannot
        // read it still reaches an endpoint it can address directly.
        this.deps.logger.warn("relay configuration unreadable; resolving the endpoint directly", {
          moduleId: ref.moduleId,
          endpointId: ref.endpointId,
          error: errorMessage(error),
        });
        return direct;
      }
      // Deliberately fail closed, even on a `local` engine where the
      // configuration would only be read for a warning: a policy without
      // directWithoutRelayConfig never proceeds on a store it could not read.
      return unavailable("store_unreadable", `the relay configuration could not be read: ${errorMessage(error)}`);
    }
    if (!config || !routesEndpoint(config, ref.moduleId, ref.endpointId)) {
      return direct;
    }
    if (this.deps.hosting === "local") {
      this.warnLocalListing(ref);
      return direct;
    }
    return this.bridge(ref, config, direct, signal);
  }

  /** Releases every permit still held for an unspent ticket. */
  stop(): void {
    for (const hold of this.held) {
      this.deps.timers.clearTimeout(hold.timer);
      hold.permit.release();
    }
    this.held.clear();
  }

  private async bridge(
    ref: LocalEndpointRef,
    config: RelayConfig,
    direct: DirectDecision,
    signal: AbortSignal
  ): Promise<EndpointResolution> {
    let address = new URL(config.bridgeOrigin).host;
    const permit = this.deps.opens.tryAcquire();
    if (permit === null) {
      return unavailable(
        "busy",
        `too many companion bridge opens in flight (${this.deps.opens.limit}); retrying later`,
        address
      );
    }
    let kept = false;
    try {
      let grant = await this.credential(false, signal);
      for (let renewed = false; ; renewed = true) {
        if (typeof grant === "string") {
          return unavailable("relay", grant, address);
        }
        // The dashboard's answer is authoritative: it may have stopped routing
        // the endpoint since the stored configuration was read.
        if (!grant || !routesEndpoint(grant, ref.moduleId, ref.endpointId)) {
          return direct;
        }
        address = new URL(grant.bridgeOrigin).host;
        const path = `/bridge/${encodeURIComponent(ref.moduleId)}/${encodeURIComponent(ref.endpointId)}`;
        const outcome = await this.requestTicket(new URL(path, grant.bridgeOrigin), grant.credential, signal);
        if (outcome.kind === "ticket") {
          kept = true;
          this.holdUntilExpired(permit, outcome.expiresInMs);
          const url = new URL(path, grant.bridgeOrigin);
          url.protocol = "wss:";
          url.searchParams.set("ticket", outcome.ticket);
          const found: EndpointResolution = { ok: true, route: "companion", url: url.toString(), address };
          if (direct.ok && direct.password !== undefined) {
            found.password = direct.password;
          }
          return found;
        }
        if (outcome.kind === "failed") {
          return unavailable("relay", outcome.message, address);
        }
        if (outcome.status === 429) {
          return unavailable(
            "busy",
            "the companion relay has too many bridge opens in flight; retrying later",
            address
          );
        }
        // A cached credential the relay no longer accepts (a rotated key, a
        // new companion host) is renewed once; a second refusal is the answer.
        if (outcome.status !== 401 || renewed) {
          return unavailable("relay", `the companion relay refused the bridge (${outcome.status})`, address);
        }
        grant = await this.credential(true, signal);
      }
    } finally {
      if (!kept) {
        permit.release();
      }
    }
  }

  /** The grant, null when nothing is routed, or why none could be had. */
  private async credential(force: boolean, signal: AbortSignal): Promise<RelayGrant | null | string> {
    try {
      return await abortable(this.deps.relayCredential(force), signal);
    } catch (error) {
      signal.throwIfAborted();
      return `no companion bridge credential: ${errorMessage(error)}`;
    }
  }

  private async requestTicket(url: URL, credential: string, signal: AbortSignal): Promise<TicketOutcome> {
    const { timers, ticketTimeoutMs } = this.deps;
    const controller = new AbortController();
    const timer = timers.setTimeout(
      () => controller.abort(new Error(`no answer within ${ticketTimeoutMs}ms`)),
      ticketTimeoutMs
    );
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await this.deps.fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${credential}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        return { kind: "refused", status: response.status };
      }
      const body = (await response.json().catch(() => null)) as { ticket?: unknown; expiresInMs?: unknown } | null;
      const ticket = body?.ticket;
      if (typeof ticket !== "string" || !TICKET.test(ticket)) {
        return { kind: "failed", message: "the companion relay answered without a ticket" };
      }
      const expiresInMs = body?.expiresInMs;
      const validFor =
        typeof expiresInMs === "number" && Number.isInteger(expiresInMs) && expiresInMs > 0
          ? expiresInMs
          : RELAY_TICKET_TTL_MS;
      return { kind: "ticket", ticket, expiresInMs: validFor };
    } catch (error) {
      signal.throwIfAborted();
      return { kind: "failed", message: `the companion relay did not answer: ${errorMessage(error)}` };
    } finally {
      timers.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }

  /**
   * The relay counts a ticket until it is presented or expires. The
   * gateway cannot see it presented, so it counts it until it expires.
   */
  private holdUntilExpired(permit: BridgeOpenPermit, expiresInMs: number): void {
    const hold: HeldPermit = {
      permit,
      timer: this.deps.timers.setTimeout(() => {
        this.held.delete(hold);
        permit.release();
      }, expiresInMs),
    };
    this.held.add(hold);
  }

  private warnLocalListing(ref: LocalEndpointRef): void {
    const key = endpointKey(ref);
    if (this.warnedLocal.has(key)) {
      return;
    }
    this.warnedLocal.add(key);
    // The bridge would loop through the cloud back to this same machine.
    this.deps.logger.warn(
      `the relay configuration routes ${key} through the companion, but this engine runs locally (WOOFX3_HOSTING=local); dialing it directly`
    );
  }
}

function unavailable(reason: EndpointUnavailable["reason"], message: string, address?: string): EndpointUnavailable {
  const result: EndpointUnavailable = { ok: false, reason, message };
  if (address !== undefined) {
    result.address = address;
  }
  return result;
}
