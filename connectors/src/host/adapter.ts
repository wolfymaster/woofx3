import type {
  EgressActionId,
  EgressPayloads,
  PlatformId,
  PlatformOutcome,
  RequestedBy,
} from "@woofx3/api/platform-gateway";
import type { DbProxyClientConfig } from "../services/db-proxy";
import type { AdapterId } from "./adapter-ids";
import type { Logger } from "./deps";
import type { ParseResult } from "./host-requests";
import type { LinkState } from "./link-readers";
import type { ScopedBus } from "./scoped-bus";

/**
 * Where an adapter is in its lifecycle, as the supervisor tracks it. Times are
 * clock milliseconds.
 *
 * - degraded: a start or a running adapter failed; the next start is at `retryAt`.
 * - parked: it failed too often and stays down until its settings change.
 */
export type AdapterStatus =
  | { state: "stopped" }
  | { state: "starting" }
  | { state: "connected"; since: number }
  | { state: "degraded"; reason: string; retryAt: number }
  | { state: "parked"; reason: string }
  | { state: "stopping" };

export type AdapterState = AdapterStatus["state"];

/** Why a served subject could not reach its adapter. */
export type UnavailableReason = "stopped" | "parked" | "starting";

export interface Unavailable {
  reason: UnavailableReason;
  /**
   * The adapter's last link state, null before the first read. Lets a reply
   * tell "nothing is linked" apart from "linked but turned off".
   */
  link: LinkState | null;
}

export interface ServedRequestContext<S = unknown> {
  /** Clock time the reply is due by. */
  deadline: number;
  /** Aborts at the deadline. */
  signal: AbortSignal;
  /** The adapter module's host state: the same object for the life of the process. */
  hostState: S;
}

/**
 * When the host hands a served subject to its handler.
 *
 * - whenRunning: only while the adapter is connected. Otherwise the caller
 *   gets `unavailableReply`, or waits while the adapter is on its way up.
 * - always: whatever the adapter's status. For requests that must not be lost
 *   while the adapter is stopped, parked or restarting; the handler keeps what
 *   it needs in the host state, which outlives every start and stop.
 */
export type ServedAvailability = "whenRunning" | "always";

/**
 * A request/reply subject an adapter answers. The host subscribes to it for
 * the whole life of the process and answers for the adapter while it is not
 * running, so a caller always gets a reply and never a timeout.
 */
export interface ServedSubject<S = unknown> {
  subject: string;
  /** Reply budget, set below the callers' own timeout for this subject. */
  budgetMs: number;
  /** Defaults to whenRunning. */
  availability?: ServedAvailability;
  handle(request: Uint8Array, ctx: ServedRequestContext<S>): Promise<Uint8Array>;
  /** The reply a caller gets while the adapter cannot answer, in this subject's own wire format. */
  unavailableReply(unavailable: Unavailable): Uint8Array;
}

/** What a platform adapter's egress handler gets with each request, besides the payload and options. */
export interface EgressContext {
  /** Aborts at the deadline. A handler stops waiting on the platform then. */
  signal: AbortSignal;
  /** Clock time the outcome is due by. */
  deadline: number;
  /** Who asked, for the adapter's own logs. Not authenticated. */
  requestedBy: RequestedBy;
  /** The sending workflow run's chain, for the adapter to attach to the platform's echo of the line. */
  workflowChain?: string;
  /**
   * Call just before the request leaves for the platform. Past this point a
   * deadline is reported as `unconfirmed` (the platform may have acted)
   * instead of "did not reach the platform", so a caller never resends it.
   */
  markSent(): void;
}

/**
 * How one platform performs one action. `parseOptions` validates the
 * request's `options[platform]` when it is present; without it, options for
 * this platform are refused. `handle` gets the parsed options, or undefined
 * when the request carried none.
 */
export interface EgressHandlerSpec<A extends EgressActionId, O = unknown> {
  parseOptions?(raw: unknown): ParseResult<O>;
  handle(payload: EgressPayloads[A], options: O | undefined, ctx: EgressContext): Promise<PlatformOutcome>;
}

/** A platform adapter's egress handlers, at most one per action. An action without one is `unsupported`. */
export type EgressHandlers = { [A in EgressActionId]?: EgressHandlerSpec<A> };

/** Every subject an adapter touches. Its ScopedBus refuses anything else. */
export interface AdapterManifest<S = unknown> {
  id: AdapterId;
  publishes: readonly string[];
  subscribes: readonly string[];
  requests: readonly string[];
  serves: readonly ServedSubject<S>[];
  /** Only a platform adapter (its id is a PlatformId) may declare egress; the platform is its id. */
  egress?: EgressHandlers;
}

/**
 * The adapter that speaks for a platform. Compiles only while every
 * PlatformId is also an AdapterId, so the gateway can always find a
 * platform's adapter by its id.
 */
export function platformAdapterId(platform: PlatformId): AdapterId {
  return platform;
}

export interface AdapterContext {
  logger: Logger;
  bus: ScopedBus;
  /** db-proxy with the service token and the host's call timeout, for every generated RPC call. */
  dbProxy: DbProxyClientConfig;
  /**
   * Tells the host a running adapter lost its connection. The host stops it and
   * restarts it with backoff, the same as a failed start. Ignored once the
   * start it belongs to has been stopped.
   */
  reportFault(reason: string): void;
}

/**
 * One integration or local connection the host runs while it is desired.
 * One instance lives for the whole process and is started and stopped any
 * number of times, never two starts at once.
 */
export interface Adapter<S = unknown> {
  readonly manifest: AdapterManifest<S>;
  /** Whether it should run, given its link state. */
  desired(link: LinkState): boolean;
  /** Resolves once connected; rejects when the connection could not be made. Gives up when `signal` aborts. */
  start(ctx: AdapterContext, signal: AbortSignal): Promise<void>;
  /** Releases everything start acquired. The host stops waiting after its stop deadline. */
  stop(reason: string): Promise<void>;
  /**
   * Extra facts shown under the adapter in /health. The host redacts keys that
   * name a secret, but an adapter must still never put one here.
   */
  detail?(): Record<string, unknown>;
}

/**
 * What a registry entry loads. `hostState` runs once at host startup and its
 * result is handed to `create` and to every served handler for the life of the
 * process, so state a served subject must keep across adapter stops and
 * restarts lives there and not in the adapter. `create` runs once, too.
 */
export interface AdapterModule<S = unknown> {
  hostState?(): S;
  create(hostState: S): Adapter<S>;
}
