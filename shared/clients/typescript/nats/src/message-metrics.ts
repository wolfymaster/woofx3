import { type Histogram, type Meter, SHORT_DURATION_BUCKETS_SECONDS } from "@woofx3/common/logging";

const MS_PER_SECOND = 1000;

/** The `error.type` of a handler that threw something that is not an Error. */
const NON_ERROR_THROWN = "non_error";

/**
 * `messaging.process.duration`: how long a subscription's handler took per
 * message. `messaging.destination.name` is the subscription's own subject (its
 * pattern, wildcards included), never the concrete subject of the message, so
 * the attribute stays one value per subscription.
 */
export class MessageProcessMetrics {
  private readonly duration: Histogram;

  constructor(
    meter: Meter,
    private readonly now: () => number = () => performance.now()
  ) {
    this.duration = meter.createHistogram("messaging.process.duration", {
      advice: { explicitBucketBoundaries: [...SHORT_DURATION_BUCKETS_SECONDS] },
      description: "Time a subscription handler took to process one message.",
      unit: "s",
    });
  }

  /** Times `run`, which stands for one handler call: its synchronous part, then its promise. */
  async around(pattern: string, run: () => void | Promise<void>): Promise<void> {
    const startedAt = this.now();
    try {
      await run();
    } catch (error) {
      this.record(pattern, startedAt, error instanceof Error ? error.name : NON_ERROR_THROWN);
      throw error;
    }
    this.record(pattern, startedAt);
  }

  private record(pattern: string, startedAt: number, errorType?: string): void {
    this.duration.record((this.now() - startedAt) / MS_PER_SECOND, {
      "messaging.system": "nats",
      "messaging.destination.name": pattern,
      ...(errorType !== undefined ? { "error.type": errorType } : {}),
    });
  }
}
