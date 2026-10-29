/**
 * How long each named stage of one piece of work took, in milliseconds, read
 * from one clock. A stage timed more than once adds up, so a loop over scenes
 * reports the time spent on all of them.
 *
 * Reported two ways: as log fields (`<stage>Ms`, plus `totalMs`) and as a
 * `Server-Timing` header, which browser devtools and the Resource Timing API
 * show next to the request it belongs to.
 */
export class StageTimings<TStage extends string> {
  private readonly startedAt: number;
  private readonly durations = new Map<TStage, number>();

  constructor(private readonly now: () => number) {
    this.startedAt = now();
  }

  /** Run `work`, adding the time it took to `stage` whether it resolves or throws. */
  async time<T>(stage: TStage, work: () => Promise<T>): Promise<T> {
    const at = this.now();
    try {
      return await work();
    } finally {
      this.durations.set(stage, (this.durations.get(stage) ?? 0) + (this.now() - at));
    }
  }

  /** `{ <stage>Ms, totalMs }`, rounded to tenths of a millisecond. */
  logFields(): Record<string, number> {
    const fields: Record<string, number> = {};
    for (const [stage, ms] of this.durations) {
      fields[`${stage}Ms`] = roundMs(ms);
    }
    fields.totalMs = roundMs(this.now() - this.startedAt);
    return fields;
  }

  /** `<stage>;dur=<ms>, …, total;dur=<ms>`. Stage names must be header tokens. */
  serverTiming(): string {
    const entries = [...this.durations].map(([stage, ms]) => `${stage};dur=${roundMs(ms)}`);
    entries.push(`total;dur=${roundMs(this.now() - this.startedAt)}`);
    return entries.join(", ");
  }
}

function roundMs(ms: number): number {
  return Math.round(ms * 10) / 10;
}
