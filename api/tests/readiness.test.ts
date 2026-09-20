import { describe, expect, test } from "bun:test";
import {
  BARKLOADER_HEARTBEAT_MAX_AGE_MS,
  checkReadiness,
  HeartbeatTracker,
  type ReadinessProbes,
} from "../src/readiness";

const NOW = 1_700_000_000_000;
const VERSION = "v0.1.0";

const MIGRATED = { applied: "0042_workflow_run_history", latest: "0042_workflow_run_history", pending: 0 };

/** A tracker that last saw barkloader report `ready` at `at`. */
function heartbeats(ready: boolean, at: number = NOW): HeartbeatTracker {
  const tracker = new HeartbeatTracker();
  tracker.record({ data: { application: "barkloader", ready } }, at);
  return tracker;
}

function probes(overrides: Partial<ReadinessProbes> = {}): ReadinessProbes {
  return {
    version: VERSION,
    migrationStatus: async () => MIGRATED,
    heartbeats: heartbeats(true),
    now: () => NOW,
    ...overrides,
  };
}

describe("checkReadiness", () => {
  test("is ready when db-proxy answers, nothing is pending and barkloader is ready", async () => {
    const readiness = await checkReadiness(probes());

    expect(readiness).toEqual({
      ready: true,
      version: VERSION,
      migrations: { applied: MIGRATED.applied, latest: MIGRATED.latest, pending: 0 },
      services: { dbProxy: true, barkloader: true },
    });
  });

  test("is not ready while db-proxy cannot be reached", async () => {
    const readiness = await checkReadiness(
      probes({
        migrationStatus: async () => {
          throw new Error("connection refused");
        },
      })
    );

    expect(readiness.ready).toBe(false);
    expect(readiness.services.dbProxy).toBe(false);
    expect(readiness.migrations).toEqual({ applied: null, latest: null, pending: null });
  });

  test("is not ready while migrations are pending", async () => {
    const readiness = await checkReadiness(
      probes({
        migrationStatus: async () => ({ applied: "0041_stream_sessions", latest: MIGRATED.latest, pending: 1 }),
      })
    );

    expect(readiness.ready).toBe(false);
    expect(readiness.services.dbProxy).toBe(true);
    expect(readiness.migrations).toEqual({ applied: "0041_stream_sessions", latest: MIGRATED.latest, pending: 1 });
  });

  test("reports an unmigrated database as having applied nothing", async () => {
    const readiness = await checkReadiness(
      probes({ migrationStatus: async () => ({ applied: "", latest: MIGRATED.latest, pending: 43 }) })
    );

    expect(readiness.migrations.applied).toBeNull();
  });

  test("is not ready until barkloader has reported ready", async () => {
    expect((await checkReadiness(probes({ heartbeats: new HeartbeatTracker() }))).services.barkloader).toBe(false);
    expect((await checkReadiness(probes({ heartbeats: heartbeats(false) }))).ready).toBe(false);
  });

  test("stops trusting a barkloader heartbeat once it goes stale", async () => {
    const stale = heartbeats(true, NOW - BARKLOADER_HEARTBEAT_MAX_AGE_MS - 1);
    const fresh = heartbeats(true, NOW - BARKLOADER_HEARTBEAT_MAX_AGE_MS + 1);

    expect((await checkReadiness(probes({ heartbeats: stale }))).services.barkloader).toBe(false);
    expect((await checkReadiness(probes({ heartbeats: fresh }))).services.barkloader).toBe(true);
  });
});

describe("HeartbeatTracker", () => {
  test("ignores payloads that are not heartbeats", () => {
    const tracker = new HeartbeatTracker();
    tracker.record({ nothing: "here" }, NOW);
    tracker.record(null, NOW);
    tracker.record({ data: { ready: true } }, NOW);

    expect(tracker.isReady("barkloader", NOW, BARKLOADER_HEARTBEAT_MAX_AGE_MS)).toBe(false);
  });

  test("a later not-ready heartbeat withdraws readiness", () => {
    const tracker = heartbeats(true, NOW - 1000);
    tracker.record({ data: { application: "barkloader", ready: false } }, NOW);

    expect(tracker.isReady("barkloader", NOW, BARKLOADER_HEARTBEAT_MAX_AGE_MS)).toBe(false);
  });
});
