// The companion gateway's contract: how a host adapter asks for a dialable
// route to a local endpoint on the streamer's network, and what it gets back.
// See docs/services/companion-gateway.md.

import type { EngineHosting } from "@woofx3/api";
import type { AdapterId } from "../host/adapter-ids";

/** One module's `local[]` endpoint. Both ids follow the relay's bridge path rules (isModuleId, isEndpointId). */
export interface LocalEndpointRef {
  moduleId: string;
  endpointId: string;
}

/** A `local[]` entry's protocol (barkloader lib_module LocalProtocol). */
export type EndpointProtocol = "websocket" | "http";

/**
 * How an endpoint is reached. The wire name is kept from ObsStatus.route:
 * "companion" means through the companion's relay bridge.
 */
export type EndpointRoute = "direct" | "companion";

/**
 * Why no route could be given.
 *
 * - not_declared: the installed module declares no such `local[]` endpoint.
 * - adapter_owned: a host adapter claims the endpoint; only it may resolve it.
 * - protocol_unsupported: the endpoint is not a websocket.
 * - not_routed: no route the policy allows, such as no address set.
 * - address_refused: a direct address outside what the policy allows.
 * - store_unreadable: db-proxy could not be read and the policy has no fallback.
 * - busy: the bridge-open cap is reached, or the relay refused more tickets.
 * - relay: no credential, the ticket was refused or unanswered, or the upgrade failed.
 */
export type EndpointUnavailableReason =
  | "not_declared"
  | "adapter_owned"
  | "protocol_unsupported"
  | "not_routed"
  | "address_refused"
  | "store_unreadable"
  | "busy"
  | "relay";

/**
 * A route found. `url` goes straight to the dialing library: through the
 * companion it carries a single-use ticket and is never logged or stored.
 * `address` is `host:port` for status reporting; through the companion it is
 * the bridge's host. `password` is the endpoint's own (OBS's), carried end to
 * end; the relay only ever carries the protocol's challenge response.
 */
export interface EndpointRouteFound {
  ok: true;
  route: EndpointRoute;
  url: string;
  address: string;
  password?: string;
}

export interface EndpointUnavailable {
  ok: false;
  reason: EndpointUnavailableReason;
  message: string;
  /** Where the attempt looked, when it got that far; the bridge's host through the companion. */
  address?: string;
}

export type EndpointResolution = EndpointRouteFound | EndpointUnavailable;

/** The settings a `local[]` entry names for an endpoint's address and password. */
export interface EndpointKeys {
  hostSetting: string;
  portSetting: string;
  passwordSetting?: string;
}

/**
 * An adapter's own configuration for its endpoint, used for each value the
 * module's settings leave empty and when db-proxy cannot be read, so an
 * engine without the module still connects as it is configured.
 */
export interface AdapterFallback {
  /** The settings to read when the installed manifest has no `local[]` entry for the endpoint. */
  keys: EndpointKeys;
  host: string;
  port: string;
  password?: string;
}

export interface ResolveOptions {
  /** Aborting it rejects the resolution with the signal's reason and abandons any bridge work. */
  signal: AbortSignal;
  fallback?: AdapterFallback;
}

/** Told to reconnect, with why in words for a log line. */
export type RouteChangeListener = (why: string) => void;

/** Handed to one adapter; resolves only the refs its manifest claims. */
export interface CompanionHandle {
  /**
   * The route for one connect attempt. Settings, relay configuration and the
   * credential are read afresh each time, and each bridge route carries a
   * fresh ticket. Never rejects for an endpoint failure, only on abort; an
   * unclaimed ref throws, because that is a bug in the adapter.
   */
  resolve(ref: LocalEndpointRef, opts: ResolveOptions): Promise<EndpointResolution>;
  /** Calls `listener` when the endpoint's route may have moved. Returns the unsubscribe. */
  onRouteChange(ref: LocalEndpointRef, listener: RouteChangeListener): () => void;
}

/** One claimed endpoint as /health shows it. Never carries a ticket, credential or password. */
export interface EndpointStatus {
  moduleId: string;
  endpointId: string;
  owner: AdapterId;
  /** Where the latest resolution went; null before the first, and after a failure short of the bridge. */
  route: EndpointRoute | null;
  address: string | null;
  /** The latest failed resolution, kept until one succeeds. `at` is clock ms. */
  lastFailure: { reason: EndpointUnavailableReason; message: string; at: number } | null;
}

export interface CompanionGatewayStatus {
  hosting: EngineHosting | null;
  endpoints: EndpointStatus[];
  bridgeOpens: BridgeOpensStatus;
}

export interface BridgeOpensStatus {
  inUse: number;
  limit: number;
  /** Opens answered `busy` because the cap was reached, since startup. */
  refused: number;
}

export interface CompanionGateway {
  /** A handle scoped to the refs this adapter's manifest claims, like ScopedBus for subjects. */
  forAdapter(id: AdapterId): CompanionHandle;
  status(): CompanionGatewayStatus;
  /** Abandons every resolution in flight and releases every bridge open. */
  stop(): Promise<void>;
}
