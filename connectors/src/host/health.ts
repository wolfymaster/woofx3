import type { GatewayCounters } from "../gateway/platform-gateway";
import type { AdapterStatus } from "./adapter";
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
  adapters: AdapterReport[];
  hostRequests: Record<string, HostRequestCounters>;
  hostBus: ReturnType<ScopeCounters["snapshot"]>;
  gateway: GatewayCounters;
}

export interface HealthBody {
  status: "ok" | "unhealthy";
  bus: { connected: boolean };
  loop: { alive: boolean; lastPassAt: string | null };
  adapters: AdapterHealth[];
  counters: {
    hostRequests: Record<string, HostRequestCounters>;
    hostBus: ReturnType<ScopeCounters["snapshot"]>;
    gateway: GatewayCounters;
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

const REDACTED = "[redacted]";

/** A key containing any of these words is treated as holding a secret. */
const SECRET_KEY = /password|token|ticket|credential/i;

/** Copies `value` with every secret-named key's value replaced, at any depth. */
export function redactDetail(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactDetail);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, SECRET_KEY.test(key) ? REDACTED : redactDetail(inner)])
    );
  }
  return value;
}

/**
 * Healthy while the bus is connected and the reconcile loop keeps running.
 * An adapter's own state never makes the host unhealthy: a parked adapter
 * is reported, and restarting the host would not fix what parked it.
 */
export function healthBody(snapshot: HealthSnapshot): HealthBody {
  const alive = snapshot.lastPassAt !== undefined && snapshot.now - snapshot.lastPassAt <= snapshot.loopStaleAfterMs;
  return {
    status: snapshot.busConnected && alive ? "ok" : "unhealthy",
    bus: { connected: snapshot.busConnected },
    loop: { alive, lastPassAt: iso(snapshot.lastPassAt) },
    adapters: snapshot.adapters.map(adapterHealth),
    counters: { hostRequests: snapshot.hostRequests, hostBus: snapshot.hostBus, gateway: snapshot.gateway },
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
    detail: report.detail === null ? null : (redactDetail(report.detail) as Record<string, unknown>),
  };
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
