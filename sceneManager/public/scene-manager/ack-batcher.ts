// Batches delivery acknowledgements so a burst of events doesn't mean
// a burst of single-item HTTP calls (see delivery-store.ts's design
// note). One batcher per ack kind (`delivered`, `completed`).
//
// An ack the server did not take is sent again: a lost `completed` leaves
// the delivery open, and an open delivery plays again after the next page
// load, while a lost `delivered` leaves it being sent to the page again.

import { encodeAckBody } from "../../contract/overlay-stream";

/** Milliseconds to accumulate acks before posting them as one batch. */
export const ACK_BATCH_WINDOW_MS = 250;

export interface AckRetry {
  /** Wait before the first resend; doubled for each after it. */
  initialMs: number;
  maxMs: number;
  /** Sends in all, the first included. */
  attempts: number;
}

/** About four minutes of resends, long enough to outlast a restarting engine. */
export const DEFAULT_ACK_RETRY: AckRetry = { initialMs: 1_000, maxMs: 30_000, attempts: 12 };

/**
 * Whether an ack answered `status` may succeed if sent again: the session
 * being renewed (401), the server busy, or failing on its side. Any other
 * refusal is about the ack itself and would be refused again.
 */
function retryable(status: number): boolean {
  return status === 401 || status === 408 || status === 429 || status >= 500;
}

/**
 * POST `{ instanceIds }` to `url`, sending it again with capped exponential
 * backoff until the server takes it, refuses it for good, or `retry.attempts`
 * sends have failed.
 */
export function postAck(
  fetchFn: typeof fetch,
  url: string,
  instanceIds: string[],
  retry: AckRetry = DEFAULT_ACK_RETRY,
  attempt = 1
): void {
  const again = (): void => {
    if (attempt >= retry.attempts) {
      console.warn("[scene-manager] gave up acknowledging", { url, attempts: attempt });
      return;
    }
    const delay = Math.min(retry.maxMs, retry.initialMs * 2 ** (attempt - 1));
    setTimeout(() => postAck(fetchFn, url, instanceIds, retry, attempt + 1), delay);
  };
  fetchFn(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: encodeAckBody(instanceIds),
  }).then(
    (response) => {
      if (!response.ok && retryable(response.status)) {
        again();
      }
    },
    () => again()
  );
}

export interface AckBatcherOptions {
  windowMs?: number;
  fetchFn?: typeof fetch;
  retry?: AckRetry;
}

/** Batches instanceIds per eventId within a short window before POSTing. */
export class AckBatcher {
  private readonly pending = new Map<string, Set<string>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly windowMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly retry: AckRetry;

  constructor(
    private readonly endpoint: (eventId: string) => string,
    options: AckBatcherOptions = {}
  ) {
    this.windowMs = options.windowMs ?? ACK_BATCH_WINDOW_MS;
    // Bound to the global for the same reason SceneEventSource binds it
    // — a bare `fetch` called as `this.fetchFn(...)` throws "Illegal
    // invocation" in the browser.
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.retry = options.retry ?? DEFAULT_ACK_RETRY;
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
      postAck(this.fetchFn, this.endpoint(eventId), [...instanceIds], this.retry);
    }
  }
}
