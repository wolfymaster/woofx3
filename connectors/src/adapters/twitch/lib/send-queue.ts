/**
 * How a job handed to the send queue ended. `full`: refused at once, because
 * `cap` jobs were already waiting. `abandoned`: its signal aborted before its
 * turn came, so it never ran.
 */
export type SendQueueRun<T> = { kind: "ran"; value: T } | { kind: "full" } | { kind: "abandoned" };

interface Waiting {
  start(): void;
}

/**
 * Runs chat writes one at a time, in the order they arrive, so lines reach
 * Twitch in the order callers sent them and a burst never sends several at
 * once into Twitch's chat rate limit. At most `cap` jobs wait behind the
 * running one; nothing is retried here.
 *
 * A job must end on its own signal: the queue waits for the running job to
 * settle before starting the next.
 */
export class SendQueue {
  private readonly waiting: Waiting[] = [];
  private running = false;

  constructor(private readonly cap: number) {
    if (!Number.isInteger(cap) || cap < 0) {
      throw new Error(`send queue cap must be a whole number of zero or more, got ${cap}`);
    }
  }

  /** How many jobs wait behind the running one. */
  get depth(): number {
    return this.waiting.length;
  }

  /**
   * Runs `work` once every job ahead of it has settled. Rejects with `work`'s
   * own error; the next job runs either way.
   */
  run<T>(work: () => Promise<T>, signal: AbortSignal): Promise<SendQueueRun<T>> {
    if (signal.aborted) {
      return Promise.resolve({ kind: "abandoned" });
    }
    if (!this.running) {
      return this.execute(work);
    }
    if (this.waiting.length >= this.cap) {
      return Promise.resolve({ kind: "full" });
    }
    return new Promise<SendQueueRun<T>>((resolve, reject) => {
      const entry: Waiting = {
        start: () => {
          signal.removeEventListener("abort", onAbort);
          this.execute(work).then(resolve, reject);
        },
      };
      const onAbort = () => {
        const index = this.waiting.indexOf(entry);
        if (index !== -1) {
          this.waiting.splice(index, 1);
          resolve({ kind: "abandoned" });
        }
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(entry);
    });
  }

  private async execute<T>(work: () => Promise<T>): Promise<SendQueueRun<T>> {
    this.running = true;
    try {
      return { kind: "ran", value: await work() };
    } finally {
      this.running = false;
      this.waiting.shift()?.start();
    }
  }
}
