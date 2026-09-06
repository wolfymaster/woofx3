// Batches delivery acknowledgements so a burst of events doesn't mean
// a burst of single-item HTTP calls (see delivery-store.ts's design
// note). One batcher per ack kind (`delivered`, `completed`).

/** Milliseconds to accumulate acks before posting them as one batch. */
export const ACK_BATCH_WINDOW_MS = 250;

export interface AckBatcherOptions {
  windowMs?: number;
  fetchFn?: typeof fetch;
}

/** Batches instanceIds per eventId within a short window before POSTing. */
export class AckBatcher {
  private readonly pending = new Map<string, Set<string>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly windowMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly endpoint: (eventId: string) => string,
    options: AckBatcherOptions = {}
  ) {
    this.windowMs = options.windowMs ?? ACK_BATCH_WINDOW_MS;
    // Bound to the global for the same reason SceneEventSource binds it
    // — a bare `fetch` called as `this.fetchFn(...)` throws "Illegal
    // invocation" in the browser.
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  add(eventId: string, instanceId: string): void {
    let set = this.pending.get(eventId);
    if (!set) {
      set = new Set();
      this.pending.set(eventId, set);
    }
    set.add(instanceId);
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), this.windowMs);
    }
  }

  private flush(): void {
    this.timer = null;
    // Snapshot the entries BEFORE clearing. Holding `this.pending`
    // directly would alias the live map, so `clear()` empties the batch
    // as well and the loop below posts nothing at all — every delivery
    // then stays open forever, the server redelivers it on every sweep,
    // and a genuinely new event ends up queued behind an ever-growing
    // backlog of stale replays.
    const batch = [...this.pending];
    this.pending.clear();
    for (const [eventId, instanceIds] of batch) {
      this.fetchFn(this.endpoint(eventId), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceIds: [...instanceIds] }),
      }).catch(() => {
        // Best-effort — a dropped ack surfaces as a server-side
        // redelivery/timeout instead, not a client-visible error.
      });
    }
  }
}
