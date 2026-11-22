import { HeartbeatEventSubject } from "@woofx3/common/cloudevents/messages.gen";
import { validateHeartbeatEvent } from "@woofx3/common/cloudevents/messages.validate.gen";

/**
 * Whether this engine is ready to serve, for `GET /ready`.
 *
 * Distinct from `/health`, which says only that the api process answers.
 * Ready means everything a caller depends on is up: db-proxy reachable, the
 * database migrated to the chain this release ships, and barkloader past its
 * boot work (bundled modules installed). A provisioner waits on this before
 * routing traffic to a new engine.
 */

/** How far the database is migrated, as db-proxy reports it. */
export interface MigrationStatus {
  /** Newest migration applied; "" when none. */
  applied: string;
  latest: string;
  pending: number;
}

export interface Readiness {
  ready: boolean;
  version: string;
  /** All null when db-proxy cannot be asked. */
  migrations: { applied: string | null; latest: string | null; pending: number | null };
  services: { dbProxy: boolean; barkloader: boolean };
}

export interface ReadinessProbes {
  /** The running release, from `WOOFX3_VERSION`. */
  version: string;
  /** Asks db-proxy; rejects when it cannot be reached. */
  migrationStatus: () => Promise<MigrationStatus>;
  heartbeats: HeartbeatTracker;
  now: () => number;
}

/**
 * Barkloader heartbeats every few seconds; a report older than this means it
 * stopped, not that it is between beats.
 */
export const BARKLOADER_HEARTBEAT_MAX_AGE_MS = 30_000;

/** Subject every service publishes heartbeats on. */
export const HEARTBEAT_SUBJECT: string = HeartbeatEventSubject.HEARTBEAT;

/** Heartbeat `application` name barkloader publishes under. */
const BARKLOADER_APPLICATION = "barkloader";

export async function checkReadiness(probes: ReadinessProbes): Promise<Readiness> {
  let migrations: Readiness["migrations"] = { applied: null, latest: null, pending: null };
  let dbProxy = false;
  try {
    const status = await probes.migrationStatus();
    migrations = {
      applied: status.applied === "" ? null : status.applied,
      latest: status.latest,
      pending: status.pending,
    };
    dbProxy = true;
  } catch {
    // Unreachable db-proxy is exactly what `dbProxy: false` reports.
  }

  const barkloader = probes.heartbeats.isReady(BARKLOADER_APPLICATION, probes.now(), BARKLOADER_HEARTBEAT_MAX_AGE_MS);

  return {
    ready: dbProxy && migrations.pending === 0 && barkloader,
    version: probes.version,
    migrations,
    services: { dbProxy, barkloader },
  };
}

/**
 * The latest readiness each service reported on the `HEARTBEAT` subject.
 *
 * Anything on the subject that does not fit the heartbeat contract is ignored rather than trusted.
 */
export class HeartbeatTracker {
  private readonly latest = new Map<string, { ready: boolean; at: number }>();

  record(payload: unknown, at: number): void {
    if (!validateHeartbeatEvent(payload)) {
      return;
    }
    this.latest.set(payload.data.application, { ready: payload.data.ready, at });
  }

  isReady(application: string, now: number, maxAgeMs: number): boolean {
    const last = this.latest.get(application);
    if (!last) {
      return false;
    }
    return last.ready && now - last.at <= maxAgeMs;
  }
}
