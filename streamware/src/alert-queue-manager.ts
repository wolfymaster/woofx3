import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { DbClient } from "./db";

/**
 * Per-application FIFO queue of alert envelopes with lease semantics.
 *
 * Phase 2 of the widget-completion plan: the workflow alert action
 * publishes intent to NATS `ui.notify.alert`; the api enqueues the
 * envelope here (status: `pending`) and dispatches one alert at a
 * time per application.
 *
 * Dispatch is a NATS publish to `ui.alert.broadcast` (consumed by
 * streamware which fans out to overlay WS clients) plus a lease
 * timer. The overlay is expected to ack via `ui.widget.status` with
 * `playing` / `completed` / `failed`. If no terminal ack arrives
 * before the lease expires, the queue manager marks the row
 * `timed_out`, emits the matching webhook, and dispatches the next
 * pending alert.
 *
 * State held in memory; persistent backstop in the `alerts` table.
 * Process restart drops in-flight + pending state — those rows
 * remain in their last persisted status (`dispatched` or `pending`)
 * and require operator replay. Hydrating on boot is a follow-up.
 */

export interface AlertEnvelope {
  /** AlertPayload envelope id (`payload.id`). Stamped by the
   *  workflow action; preserved end-to-end. */
  id: string;
  /** Carried for routing / scoping. May be empty for manual /
   *  debug publishers; in that case the api's singleton fallback
   *  fills it in before reaching this manager. */
  applicationId: string;
  /** Author parameters (widget, text, mediaUrl, audioUrl, duration,
   *  options, …). The queue manager only inspects `duration` for
   *  lease sizing. */
  parameters: Record<string, unknown> & { duration?: unknown };
  /** Originating CloudEvent or null. Pass-through. */
  event: unknown;
  /** Verbatim original payload bytes — broadcast verbatim so the
   *  overlay sees exactly what the workflow authored. We store
   *  the parsed envelope above and the raw JSON here so we don't
   *  re-marshal needlessly on dispatch. */
  rawJson: string;
}

interface Lease {
  envelope: AlertEnvelope;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_DURATION_S = 5;
const LEASE_BUFFER_S = 5;
const MAX_LEASE_S = 60;

export interface AlertQueueManagerOptions {
  /** Override the lease buffer (seconds added to the alert's
   *  declared duration before timing out). Tests use a tight
   *  value; production keeps the default. */
  leaseBufferSeconds?: number;
  /** Cap the lease at this many seconds regardless of declared
   *  duration. Guards against a runaway `duration: 999` that would
   *  otherwise hang the queue. */
  maxLeaseSeconds?: number;
}

export class AlertQueueManager {
  private readonly queues = new Map<string, AlertEnvelope[]>();
  private readonly leases = new Map<string, Lease>();
  private readonly leaseBufferSeconds: number;
  private readonly maxLeaseSeconds: number;

  constructor(
    private readonly db: DbClient,
    private readonly nats: NATSClient | null,
    private readonly logger: SharedLogger,
    opts: AlertQueueManagerOptions = {}
  ) {
    this.leaseBufferSeconds = opts.leaseBufferSeconds ?? LEASE_BUFFER_S;
    this.maxLeaseSeconds = opts.maxLeaseSeconds ?? MAX_LEASE_S;
  }

  /** Test / introspection helpers. Never used in hot paths. */
  pendingCount(applicationId: string): number {
    return this.queues.get(applicationId)?.length ?? 0;
  }

  inFlight(applicationId: string): AlertEnvelope | null {
    return this.leases.get(applicationId)?.envelope ?? null;
  }

  /**
   * Enqueue a fresh alert. If no in-flight lease exists for this
   * application, dispatch immediately; otherwise the alert waits
   * its turn behind the current lease and any earlier pending
   * envelopes.
   */
  async enqueue(envelope: AlertEnvelope): Promise<void> {
    if (!envelope.applicationId) {
      this.logger.warn("AlertQueueManager.enqueue: missing applicationId; dropping", {
        envelopeId: envelope.id,
      });
      return;
    }
    if (!envelope.id) {
      this.logger.warn("AlertQueueManager.enqueue: missing envelope id; dropping", {
        applicationId: envelope.applicationId,
      });
      return;
    }
    const q = this.queues.get(envelope.applicationId) ?? [];
    q.push(envelope);
    this.queues.set(envelope.applicationId, q);
    this.logger.info("alert enqueued", {
      applicationId: envelope.applicationId,
      envelopeId: envelope.id,
      pendingCount: q.length,
      hasInFlight: this.leases.has(envelope.applicationId),
    });
    if (!this.leases.has(envelope.applicationId)) {
      await this.dispatchNext(envelope.applicationId);
    }
  }

  /**
   * Apply an overlay-reported state transition. Stale acks (for an
   * envelope that's no longer in flight, or for a different
   * application) are silently ignored — they're a routine side
   * effect of reconnects and lease expirations.
   */
  async handleStatus(
    applicationId: string,
    envelopeId: string,
    state: "playing" | "completed" | "failed",
    error?: string
  ): Promise<void> {
    const lease = this.leases.get(applicationId);
    if (!lease) {
      this.logger.debug("status report ignored — no in-flight lease", {
        applicationId,
        envelopeId,
        state,
      });
      return;
    }
    if (lease.envelope.id !== envelopeId) {
      this.logger.debug("status report ignored — stale envelope id", {
        applicationId,
        ackEnvelopeId: envelopeId,
        inFlightEnvelopeId: lease.envelope.id,
        state,
      });
      return;
    }
    // Persist the lifecycle transition first so a crash between
    // the db update and the in-memory bookkeeping doesn't leave
    // the row stuck at `dispatched` while we've cleared the lease.
    try {
      await this.db.updateAlertLifecycle({
        applicationId,
        envelopeId,
        status: state,
        error: state === "failed" ? (error ?? "") : "",
      });
    } catch (err) {
      this.logger.warn("handleStatus: db update failed", {
        applicationId,
        envelopeId,
        state,
        error: err instanceof Error ? err.message : String(err),
      });
      // Continue anyway — the lease bookkeeping is still
      // important to avoid a stuck queue.
    }

    if (state === "playing") {
      // We received the mount ack — refresh the lease so a long
      // alert with a slow start doesn't time out spuriously.
      clearTimeout(lease.timer);
      const duration = this.alertDurationSeconds(lease.envelope);
      // Once playing, the budget shrinks: alert should finish
      // within `duration + 2 s`.
      lease.timer = setTimeout(
        () => void this.handleTimeout(applicationId),
        (duration + 2) * 1000
      );
      return;
    }
    // Terminal: clear lease, dispatch next.
    clearTimeout(lease.timer);
    this.leases.delete(applicationId);
    this.logger.info("alert lease cleared", {
      applicationId,
      envelopeId,
      state,
      error: error || undefined,
    });
    await this.dispatchNext(applicationId);
  }

  /**
   * Mark the in-flight alert (if any) as `skipped` and dispatch the
   * next pending. No-op when nothing is playing. Phase 3 surfaces
   * this via a Twirp RPC; callable here so tests can drive it
   * directly.
   */
  async skipCurrent(applicationId: string): Promise<boolean> {
    const lease = this.leases.get(applicationId);
    if (!lease) {
      return false;
    }
    clearTimeout(lease.timer);
    this.leases.delete(applicationId);
    try {
      await this.db.updateAlertLifecycle({
        applicationId,
        envelopeId: lease.envelope.id,
        status: "skipped",
        error: "",
      });
    } catch (err) {
      this.logger.warn("skipCurrent: db update failed", {
        applicationId,
        envelopeId: lease.envelope.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await this.dispatchNext(applicationId);
    return true;
  }

  /**
   * Drop every pending alert and mark them `skipped` in the db. Does
   * not touch the in-flight lease (use `skipCurrent` for that).
   */
  async clearPending(applicationId: string): Promise<number> {
    const q = this.queues.get(applicationId) ?? [];
    if (q.length === 0) {
      return 0;
    }
    this.queues.set(applicationId, []);
    let cleared = 0;
    for (const env of q) {
      try {
        await this.db.updateAlertLifecycle({
          applicationId,
          envelopeId: env.id,
          status: "skipped",
          error: "",
        });
        cleared += 1;
      } catch (err) {
        this.logger.warn("clearPending: db update failed for envelope", {
          applicationId,
          envelopeId: env.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return cleared;
  }

  // ─────────────────────────────── internals ────────────────────────────────

  private async dispatchNext(applicationId: string): Promise<void> {
    const q = this.queues.get(applicationId) ?? [];
    const envelope = q.shift();
    if (!envelope) {
      this.queues.delete(applicationId);
      return;
    }
    this.queues.set(applicationId, q);

    // Stamp `dispatched` first so a crash between the publish and
    // the db update doesn't leave the row stuck at `pending` while
    // the overlay has actually played the alert.
    try {
      await this.db.updateAlertLifecycle({
        applicationId,
        envelopeId: envelope.id,
        status: "dispatched",
        error: "",
      });
    } catch (err) {
      this.logger.warn("dispatchNext: db status=dispatched update failed", {
        applicationId,
        envelopeId: envelope.id,
        error: err instanceof Error ? err.message : String(err),
      });
      // Non-fatal: keep going. The overlay still gets the broadcast.
    }

    if (!this.nats) {
      this.logger.error("dispatchNext: NATS unavailable; alert dropped", {
        applicationId,
        envelopeId: envelope.id,
      });
      // Mark timed-out so the row doesn't sit at `dispatched`
      // forever and the operator can replay.
      await this.markTimedOut(applicationId, envelope, "nats unavailable");
      // Keep going through the queue — subsequent envelopes will
      // hit the same NATS-unavailable branch but the operator
      // sees the failure pattern.
      await this.dispatchNext(applicationId);
      return;
    }

    try {
      const bytes = new TextEncoder().encode(envelope.rawJson);
      await this.nats.publish("ui.alert.broadcast", bytes);
    } catch (err) {
      this.logger.error("dispatchNext: NATS publish failed", {
        applicationId,
        envelopeId: envelope.id,
        error: err instanceof Error ? err.message : String(err),
      });
      await this.markTimedOut(applicationId, envelope, "publish failed");
      await this.dispatchNext(applicationId);
      return;
    }

    const duration = this.alertDurationSeconds(envelope);
    const leaseSeconds = Math.min(duration + this.leaseBufferSeconds, this.maxLeaseSeconds);
    const timer = setTimeout(
      () => void this.handleTimeout(applicationId),
      leaseSeconds * 1000
    );
    this.leases.set(applicationId, { envelope, timer });
    this.logger.info("alert dispatched", {
      applicationId,
      envelopeId: envelope.id,
      leaseSeconds,
      pendingAfter: q.length,
    });
  }

  private async handleTimeout(applicationId: string): Promise<void> {
    const lease = this.leases.get(applicationId);
    if (!lease) {
      return;
    }
    this.leases.delete(applicationId);
    this.logger.warn("alert lease timed out", {
      applicationId,
      envelopeId: lease.envelope.id,
    });
    await this.markTimedOut(applicationId, lease.envelope, "lease timeout");
    await this.dispatchNext(applicationId);
  }

  private async markTimedOut(
    applicationId: string,
    envelope: AlertEnvelope,
    reason: string
  ): Promise<void> {
    try {
      await this.db.updateAlertLifecycle({
        applicationId,
        envelopeId: envelope.id,
        status: "timed_out",
        error: reason,
      });
    } catch (err) {
      this.logger.warn("markTimedOut: db update failed", {
        applicationId,
        envelopeId: envelope.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private alertDurationSeconds(envelope: AlertEnvelope): number {
    const raw = envelope.parameters?.duration;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      return DEFAULT_DURATION_S;
    }
    return n;
  }
}
