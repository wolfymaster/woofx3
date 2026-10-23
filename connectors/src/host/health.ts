import type { ModuleSessionStatus, ModuleSessionsStatus } from "../companion/endpoint-sessions";
import type { ModuleRequestCounters } from "../companion/module-requests";
import type { BridgeOpensStatus, CompanionGatewayStatus, EndpointStatus } from "../companion/types";
import type { GatewayCounters } from "../gateway/platform-gateway";
import type { AdapterStatus } from "./adapter";
import type { ChatSnapshot } from "./chat-service";
import type { HostRequestCounters } from "./host-requests";
import type { ScopeCounters } from "./scoped-bus";
import type { AdapterReport } from "./supervisor";

/** Everything /health reports, gathered at request time. Times are clock milliseconds. */
export interface HealthSnapshot {
  now: number;
  busConnected: boolean;
  /** When the settings watcher last finished a pass; undefined before the first. */
  lastPassAt: number | undefined;
  /** A pass this much older than `now` means the reconcile loop has stopped. */
  loopStaleAfterMs: number;
  /** Settings passes in a row in which every link read failed. */
  failedLinkPasses: number;
  /** This many failed passes in a row means db-proxy is unreachable. */
  dbProxyUnreachableAfterPasses: number;
  adapters: AdapterReport[];
  hostRequests: Record<string, HostRequestCounters>;
  hostBus: ReturnType<ScopeCounters["snapshot"]>;
  gateway: GatewayCounters;
  chat: ChatSnapshot;
  companion: CompanionGatewayStatus;
}

export interface HealthBody {
  status: "ok" | "unhealthy";
  bus: { connected: boolean };
  loop: { alive: boolean; lastPassAt: string | null };
  dbProxy: { reachable: boolean; failedPasses: number };
  adapters: AdapterHealth[];
  companion: CompanionHealth;
  counters: {
    hostRequests: Record<string, HostRequestCounters>;
    hostBus: ReturnType<ScopeCounters["snapshot"]>;
    gateway: GatewayCounters;
    chat: ChatSnapshot;
  };
}

export interface AdapterHealth {
  id: string;
  state: AdapterStatus["state"];
  reason: string | null;
  since: string | null;
  retryAt: string | null;
  changedAt: string;
  link: AdapterReport["link"];
  counts: AdapterReport["counts"];
  bus: AdapterReport["bus"];
  detail: Record<string, unknown> | null;
}

/**
 * The companion gateway: each claimed local endpoint and where it was last
 * reached, and the sessions held for module requests.
 */
export interface CompanionHealth {
  hosting: CompanionGatewayStatus["hosting"];
  endpoints: Array<
    Omit<EndpointStatus, "lastFailure"> & {
      lastFailure: { reason: string; message: string; at: string } | null;
    }
  >;
  bridgeOpens: BridgeOpensStatus;
  modules: {
    sessions: Omit<ModuleSessionsStatus, "sessions"> & {
      sessions: Array<Omit<ModuleSessionStatus, "openedAt"> & { openedAt: string }>;
    };
    requests: ModuleRequestCounters;
  };
}

const REDACTED = "[redacted]";

/** A key containing any of these words is treated as holding a secret. */
const SECRET_KEY = /password|token|ticket|credential/i;

/**
 * Copies `value` with every secret-named key's value replaced, at any depth.
 * The copy keeps the shape of `T` except that a replaced value is the string
 * "[redacted]" whatever type `T` gives it; callers only serialize the result.
 */
export function redactDetail<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, SECRET_KEY.test(key) ? REDACTED : redactValue(inner)])
    );
  }
  return value;
}

/**
 * Healthy while the bus is connected, the reconcile loop keeps running and its
 * link reads reach db-proxy. An adapter's own state never makes the host unhealthy: a parked adapter
 * is reported, and restarting the host would not fix what parked it.
 */
export function healthBody(snapshot: HealthSnapshot): HealthBody {
  const alive = snapshot.lastPassAt !== undefined && snapshot.now - snapshot.lastPassAt <= snapshot.loopStaleAfterMs;
  const reachable = snapshot.failedLinkPasses < snapshot.dbProxyUnreachableAfterPasses;
  return {
    status: snapshot.busConnected && alive && reachable ? "ok" : "unhealthy",
    bus: { connected: snapshot.busConnected },
    loop: { alive, lastPassAt: iso(snapshot.lastPassAt) },
    dbProxy: { reachable, failedPasses: snapshot.failedLinkPasses },
    adapters: snapshot.adapters.map(adapterHealth),
    companion: companionHealth(snapshot.companion),
    counters: {
      hostRequests: snapshot.hostRequests,
      hostBus: snapshot.hostBus,
      gateway: snapshot.gateway,
      chat: snapshot.chat,
    },
  };
}

function adapterHealth(report: AdapterReport): AdapterHealth {
  const { status } = report;
  return {
    id: report.id,
    state: status.state,
    reason: status.state === "degraded" || status.state === "parked" ? status.reason : null,
    since: status.state === "connected" ? iso(status.since) : null,
    retryAt: status.state === "degraded" ? iso(status.retryAt) : null,
    changedAt: new Date(report.changedAt).toISOString(),
    link: report.link,
    counts: report.counts,
    bus: report.bus,
    detail: redactDetail(report.detail),
  };
}

/**
 * The companion gateway never puts a ticket, credential or password in its
 * status. It is redacted like adapter detail all the same, so a field named
 * for a secret can never reach the body.
 */
function companionHealth(status: CompanionGatewayStatus): CompanionHealth {
  const body: CompanionHealth = {
    hosting: status.hosting,
    endpoints: status.endpoints.map((endpoint) => ({
      ...endpoint,
      lastFailure:
        endpoint.lastFailure === null
          ? null
          : { ...endpoint.lastFailure, at: new Date(endpoint.lastFailure.at).toISOString() },
    })),
    bridgeOpens: status.bridgeOpens,
    modules: {
      sessions: {
        ...status.modules.sessions,
        sessions: status.modules.sessions.sessions.map((session) => ({
          ...session,
          openedAt: new Date(session.openedAt).toISOString(),
        })),
      },
      requests: status.modules.requests,
    },
  };
  return redactDetail(body);
}

function iso(ms: number | undefined): string | null {
  return ms === undefined ? null : new Date(ms).toISOString();
}

export const HEALTH_PATH = "/health";

/** GET /health answers 200 or 503 with the body; every other request gets 404 in the error envelope. */
export function handleHealthRequest(request: Request, snapshot: () => HealthSnapshot): Response {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname !== HEALTH_PATH) {
    return Response.json(
      { error: { code: "not_found", message: `${request.method} ${url.pathname} is not served here` } },
      { status: 404 }
    );
  }
  const body = healthBody(snapshot());
  return Response.json(body, { status: body.status === "ok" ? 200 : 503 });
}

export interface HealthServer {
  readonly port: number;
  stop(): Promise<void>;
}

/** Listens on loopback only: the route is for the orchestrator on the same machine. */
export function startHealthServer(port: number, snapshot: () => HealthSnapshot): HealthServer {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: (request) => handleHealthRequest(request, snapshot),
  });
  const bound = server.port;
  if (bound === undefined) {
    throw new Error(`the health server did not bind a port (asked for ${port})`);
  }
  return {
    port: bound,
    stop: () => server.stop(true),
  };
}
