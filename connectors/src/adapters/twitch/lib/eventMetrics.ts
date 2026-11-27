import { LONG_DURATION_BUCKETS_SECONDS, type Meter } from "@woofx3/common/logging";
import type { Clock } from "../../../host/deps";

const MS_PER_SECOND = 1000;

/**
 * What an operator reads to tell whether events are arriving: a count by type,
 * how long ago the last one came, and how late it was against the platform's
 * own clock.
 *
 * `platform` is a bounded set (one value per integration) and `event.type` is
 * a catalog subject, so neither grows with viewers.
 */
export class EventMetrics {
  private readonly received: ReturnType<Meter["createCounter"]>;
  private readonly ingestLag: ReturnType<Meter["createHistogram"]>;
  private readonly lastReceivedSeconds = new Map<string, number>();

  constructor(
    meter: Meter,
    private readonly clock: Clock
  ) {
    this.received = meter.createCounter("woofx3.events.received", {
      description: "Events received from a platform and handed to the bus.",
      unit: "{event}",
    });
    this.ingestLag = meter.createHistogram("woofx3.event.ingest.lag", {
      advice: { explicitBucketBoundaries: [...LONG_DURATION_BUCKETS_SECONDS] },
      description: "Time from the platform's own timestamp to the event reaching the engine.",
      unit: "s",
    });
    meter
      .createObservableGauge("woofx3.events.last_received_time", {
        description: "Unix time the most recent event arrived from a platform.",
        unit: "s",
      })
      .addCallback((result) => {
        for (const [platform, seconds] of this.lastReceivedSeconds) {
          result.observe(seconds, { platform });
        }
      });
  }

  /** `occurredAt` is the platform's timestamp for the event, when it supplies one. */
  record(platform: string, eventType: string, occurredAt?: Date): void {
    const now = this.clock.now();
    this.received.add(1, { "event.type": eventType, platform });
    this.lastReceivedSeconds.set(platform, now / MS_PER_SECOND);
    if (occurredAt !== undefined) {
      this.ingestLag.record(Math.max(0, now - occurredAt.getTime()) / MS_PER_SECOND, { platform });
    }
  }
}
