import {
  ALERT_OVERVIEW_BUCKET_MS,
  ALERT_OVERVIEW_DEFAULT_HOURS,
  ALERT_OVERVIEW_MAX_HOURS,
  type AlertOutcome,
  type AlertOverview,
  type AlertOverviewTotals,
} from "@woofx3/api";
import type * as alert from "@woofx3/db/alert.pb";

/**
 * How long an alert still on its way may go unreported before it counts as
 * unconfirmed. An alert plays for seconds; past this the engine has lost
 * track of it (an overlay closed mid-play, sceneManager restarted) and no
 * report is coming. Any later report moves it on, and it counts again by
 * its real state.
 */
export const ALERT_UNCONFIRMED_AFTER_MS = 15 * 60 * 1000;

/** The window an overview covers, from the caller's arguments; refuses any out of range. */
export function overviewWindow(hourStart: unknown, windowHours: unknown): { since: number; hours: number } {
  if (
    typeof hourStart !== "number" ||
    !Number.isSafeInteger(hourStart) ||
    hourStart < 0 ||
    hourStart % ALERT_OVERVIEW_BUCKET_MS !== 0
  ) {
    throw new Error("hourStart must be an epoch-milliseconds time on the hour");
  }
  const hours = windowHours === undefined ? ALERT_OVERVIEW_DEFAULT_HOURS : windowHours;
  if (typeof hours !== "number" || !Number.isInteger(hours) || hours < 1 || hours > ALERT_OVERVIEW_MAX_HOURS) {
    throw new Error(`windowHours must be a whole number from 1 to ${ALERT_OVERVIEW_MAX_HOURS}`);
  }
  const since = hourStart - (hours - 1) * ALERT_OVERVIEW_BUCKET_MS;
  if (since < 0) {
    throw new Error("the window must not start before the epoch");
  }
  return { since, hours };
}

/** db-proxy's outcomes, as the api names them. db-proxy owns the rule from status to outcome. */
const OUTCOMES: Record<Exclude<alert.AlertOutcome, "ALERT_OUTCOME_UNSPECIFIED">, AlertOutcome> = {
  ALERT_OUTCOME_COMPLETED: "completed",
  ALERT_OUTCOME_FAILED: "failed",
  ALERT_OUTCOME_SKIPPED: "skipped",
  ALERT_OUTCOME_REPLAYED: "replayed",
  ALERT_OUTCOME_IN_FLIGHT: "inFlight",
  ALERT_OUTCOME_UNCONFIRMED: "unconfirmed",
};

/** db-proxy's outcome as the api names it; refuses one this build does not know. */
export function outcomeFromProto(outcome: alert.AlertOutcome): AlertOutcome {
  const named = (OUTCOMES as Record<string, AlertOutcome | undefined>)[outcome];
  if (named === undefined) {
    throw new Error(`db-proxy counted alerts with outcome ${outcome}, which this api does not know`);
  }
  return named;
}

/** The overview of a window from db-proxy's per-hour counts. */
export function buildAlertOverview(
  since: number,
  hours: number,
  { counts, truncated }: { counts: readonly alert.AlertHourCount[]; truncated: boolean }
): AlertOverview {
  const buckets = Array.from({ length: hours }, (_, index) => ({
    start: since + index * ALERT_OVERVIEW_BUCKET_MS,
    total: 0,
    failed: 0,
  }));
  const totals: AlertOverviewTotals = {
    total: 0,
    completed: 0,
    failed: 0,
    inFlight: 0,
    unconfirmed: 0,
    skipped: 0,
    replayed: 0,
  };
  for (const { hour, outcome: counted, count } of counts) {
    const bucket = buckets[hour];
    if (!Number.isInteger(hour) || bucket === undefined) {
      throw new Error(`db-proxy counted alerts in hour ${hour} of a ${hours}-hour window`);
    }
    const n = Number(count);
    const outcome = outcomeFromProto(counted);
    totals.total += n;
    totals[outcome] += n;
    bucket.total += n;
    if (outcome === "failed") {
      bucket.failed += n;
    }
  }
  return { hours, since, bucketMs: ALERT_OVERVIEW_BUCKET_MS, truncated, totals, buckets };
}
