import {
  type Counter,
  type Histogram,
  LONG_DURATION_BUCKETS_SECONDS,
  type Meter,
  SHORT_DURATION_BUCKETS_SECONDS,
} from "@woofx3/common/logging";
import { ALERT_EVENT_TYPE } from "../scene/alert-layout";

const MS_PER_SECOND = 1000;

/**
 * How an alert's life ended or where it stands: `queued` when it was recorded
 * for a running scene, `played` when a page finished it, `skipped` when an
 * operator ended the one on screen, `dropped` when a Clear removed it from the
 * waiting queue, and `failed` when it never reached a scene.
 */
export type AlertOutcome = "queued" | "played" | "skipped" | "dropped" | "failed";

/** The stages an alert's dispatch is timed by; a closed set, so `stage` stays bounded. */
export type DispatchStage = "layout" | "frames" | "scenes" | "record";

/**
 * What an operator reads to tell whether alerts are flowing: outcomes over
 * time, how many wait, how long they wait, and where dispatch spends its time.
 * No attribute carries an alert, scene or widget id.
 */
export class AlertMetrics {
  private readonly alerts: Counter;
  private readonly queueWait: Histogram;
  private readonly pipelineDuration: Histogram;

  constructor(private readonly meter: Meter) {
    this.alerts = meter.createCounter("woofx3.alerts", {
      description: "Alerts by how they ended or where they stand.",
      unit: "{alert}",
    });
    this.queueWait = meter.createHistogram("woofx3.alerts.queue.wait", {
      advice: { explicitBucketBoundaries: [...LONG_DURATION_BUCKETS_SECONDS] },
      description: "Time from an alert being recorded for a widget to a page reporting it started.",
      unit: "s",
    });
    this.pipelineDuration = meter.createHistogram("woofx3.event.pipeline.duration", {
      advice: { explicitBucketBoundaries: [...SHORT_DURATION_BUCKETS_SECONDS] },
      description: "Time an alert's dispatch spent in each stage before any page heard of it.",
      unit: "s",
    });
  }

  /** Registers the queue depth gauge; `waiting` counts the alerts no page has started. */
  observeQueueDepth(waiting: () => number): void {
    this.meter
      .createObservableGauge("woofx3.alerts.queue.depth", {
        description: "Alerts waiting for a page to start them.",
        unit: "{alert}",
      })
      .addCallback((result) => result.observe(waiting()));
  }

  count(outcome: AlertOutcome, alerts = 1): void {
    if (alerts > 0) {
      this.alerts.add(alerts, { outcome });
    }
  }

  /** `recordedAt` and `startedAt` are epoch milliseconds; deliveries of other types are ignored. */
  deliveryStarted(type: string, recordedAt: number, startedAt: number): void {
    if (type === ALERT_EVENT_TYPE) {
      this.queueWait.record(Math.max(0, startedAt - recordedAt) / MS_PER_SECOND);
    }
  }

  stages(durationsMs: ReadonlyMap<DispatchStage, number>): void {
    for (const [stage, ms] of durationsMs) {
      this.pipelineDuration.record(ms / MS_PER_SECOND, { stage });
    }
  }
}
