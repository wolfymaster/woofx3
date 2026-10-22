import { describe, expect, test } from "bun:test";
import {
  ALERT_OVERVIEW_MAX_HOURS,
  type AlertOutcome,
  ENGINE_CAPABILITIES,
  supportedEngineCapabilities,
} from "@woofx3/api";
import type * as alert from "@woofx3/db/alert.pb";
import {
  ALERT_UNCONFIRMED_AFTER_MS,
  buildAlertOverview,
  outcomeFromProto,
  overviewWindow,
} from "../src/alert-overview";
import { RPC_METHODS } from "../src/api-session";
import { alertsRoutes } from "../src/routes/alerts";

const HOUR = 60 * 60 * 1000;
/** 2026-10-22T12:00:00Z. */
const HOUR_START = 1_792_670_400_000;

function count(hour: number, outcome: alert.AlertOutcome, n: number): alert.AlertHourCount {
  return { hour, outcome, count: BigInt(n) };
}

describe("outcomeFromProto", () => {
  const cases: [alert.AlertOutcome, AlertOutcome][] = [
    ["ALERT_OUTCOME_COMPLETED", "completed"],
    ["ALERT_OUTCOME_FAILED", "failed"],
    ["ALERT_OUTCOME_SKIPPED", "skipped"],
    ["ALERT_OUTCOME_REPLAYED", "replayed"],
    ["ALERT_OUTCOME_IN_FLIGHT", "inFlight"],
    ["ALERT_OUTCOME_UNCONFIRMED", "unconfirmed"],
  ];
  for (const [outcome, named] of cases) {
    test(`${outcome} -> ${named}`, () => {
      expect(outcomeFromProto(outcome)).toBe(named);
    });
  }

  test("refuses an outcome this build does not know", () => {
    expect(() => outcomeFromProto("ALERT_OUTCOME_UNSPECIFIED")).toThrow("does not know");
    expect(() => outcomeFromProto(9 as unknown as alert.AlertOutcome)).toThrow("does not know");
  });
});

describe("overviewWindow", () => {
  test("defaults to the 24 hours ending with the hour that starts at hourStart", () => {
    expect(overviewWindow(HOUR_START, undefined)).toEqual({ since: HOUR_START - 23 * HOUR, hours: 24 });
  });

  test("covers one hour or a whole week", () => {
    expect(overviewWindow(HOUR_START, 1)).toEqual({ since: HOUR_START, hours: 1 });
    expect(overviewWindow(HOUR_START, ALERT_OVERVIEW_MAX_HOURS).hours).toBe(168);
  });

  const refused: [string, unknown, unknown, string][] = [
    ["an hourStart off the hour", HOUR_START + 1, undefined, "on the hour"],
    ["a fractional hourStart", HOUR_START + 0.5, undefined, "on the hour"],
    ["a negative hourStart", -HOUR, undefined, "on the hour"],
    ["an hourStart that is not a number", String(HOUR_START), undefined, "on the hour"],
    ["no hours", HOUR_START, 0, "1 to 168"],
    ["more than a week", HOUR_START, 169, "1 to 168"],
    ["a fractional window", HOUR_START, 1.5, "1 to 168"],
    ["a window that is not a number", HOUR_START, "24", "1 to 168"],
    ["a window starting before the epoch", HOUR, 24, "before the epoch"],
  ];
  for (const [name, hourStart, windowHours, reason] of refused) {
    test(`refuses ${name}`, () => {
      expect(() => overviewWindow(hourStart, windowHours)).toThrow(reason);
    });
  }
});

describe("buildAlertOverview", () => {
  test("totals every outcome and buckets each hour, oldest first", () => {
    const since = HOUR_START - 2 * HOUR;
    const overview = buildAlertOverview(since, 3, {
      counts: [
        count(0, "ALERT_OUTCOME_COMPLETED", 4),
        count(0, "ALERT_OUTCOME_FAILED", 1),
        count(1, "ALERT_OUTCOME_FAILED", 2),
        count(1, "ALERT_OUTCOME_REPLAYED", 1),
        count(2, "ALERT_OUTCOME_IN_FLIGHT", 3),
        count(2, "ALERT_OUTCOME_UNCONFIRMED", 2),
        count(2, "ALERT_OUTCOME_SKIPPED", 1),
      ],
      truncated: false,
    });

    expect(overview).toEqual({
      hours: 3,
      since,
      bucketMs: HOUR,
      truncated: false,
      totals: { total: 14, completed: 4, failed: 3, inFlight: 3, unconfirmed: 2, skipped: 1, replayed: 1 },
      buckets: [
        { start: since, total: 5, failed: 1 },
        { start: since + HOUR, total: 3, failed: 2 },
        { start: since + 2 * HOUR, total: 6, failed: 0 },
      ],
    });
  });

  test("an empty window is all zeros, with a bucket for every hour", () => {
    const overview = buildAlertOverview(HOUR_START, 2, { counts: [], truncated: false });

    expect(overview.totals.total).toBe(0);
    expect(overview.buckets).toEqual([
      { start: HOUR_START, total: 0, failed: 0 },
      { start: HOUR_START + HOUR, total: 0, failed: 0 },
    ]);
  });

  test("carries db-proxy's word that retention truncated the window", () => {
    expect(buildAlertOverview(HOUR_START, 1, { counts: [], truncated: true }).truncated).toBe(true);
  });

  test("refuses a count outside the window", () => {
    const outside = (hour: number) => ({ counts: [count(hour, "ALERT_OUTCOME_COMPLETED", 1)], truncated: false });
    expect(() => buildAlertOverview(HOUR_START, 2, outside(2))).toThrow("hour 2 of a 2-hour window");
    expect(() => buildAlertOverview(HOUR_START, 2, outside(-1))).toThrow("hour -1");
  });
});

describe("getAlertOverview", () => {
  function overviewRoute(counts: alert.AlertHourCount[], now: number) {
    const requests: alert.CountAlertsByHourRequest[] = [];
    const host = {
      clock: () => now,
      db: {
        async countAlertsByHour(req: alert.CountAlertsByHourRequest) {
          requests.push(req);
          return { counts, truncated: false };
        },
      },
    };
    const route = alertsRoutes.getAlertOverview as unknown as (...args: unknown[]) => Promise<unknown>;
    return { requests, run: (...args: unknown[]) => route.call(host, ...args) };
  }

  const seconds = (ms: number) => ({ seconds: BigInt(ms / 1000), nanos: 0 });

  test("asks db-proxy for the window, with the unconfirmed bound from the engine's clock", async () => {
    const now = HOUR_START + 20 * 60 * 1000;
    const { requests, run } = overviewRoute([count(23, "ALERT_OUTCOME_COMPLETED", 2)], now);

    const overview = (await run(HOUR_START)) as { totals: { completed: number }; buckets: unknown[] };

    expect(requests).toEqual([
      {
        since: seconds(HOUR_START - 23 * HOUR),
        hours: 24,
        unconfirmedBefore: seconds(now - ALERT_UNCONFIRMED_AFTER_MS),
      },
    ]);
    expect(overview.totals.completed).toBe(2);
    expect(overview.buckets).toHaveLength(24);
  });

  test("refuses an invalid window without asking db-proxy", async () => {
    const { requests, run } = overviewRoute([], HOUR_START);

    await expect(run(HOUR_START, 169)).rejects.toThrow("1 to 168");
    await expect(run(HOUR_START + 1)).rejects.toThrow("on the hour");
    expect(requests).toEqual([]);
  });

  test("is advertised as alerts.overview and reachable over RPC", () => {
    expect(supportedEngineCapabilities()).toContain(ENGINE_CAPABILITIES.alertsOverview);
    expect(RPC_METHODS as readonly string[]).toContain("getAlertOverview");
  });
});
