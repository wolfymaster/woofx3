import type { Logger } from "@woofx3/common/runtime";
import type { DbClient } from "../db";

/** One addressed delivery pushed down the SSE stream — always scoped
 *  to a single target widget instance, even though many instances can
 *  share the same parent eventId from one fan-out. */
export interface DeliveryFrame {
  eventId: string;
  instanceId: string;
  type: string;
  key: string;
  value: unknown;
}

interface OpenDelivery {
  eventId: string;
  sceneId: string;
  instanceId: string;
  type: string;
  key: string;
  value: unknown;
  lastAttemptAt: number;
}

type SseController = ReadableStreamDefaultController<Uint8Array>;

const REDELIVER_AFTER_MS = 5_000;
const SWEEP_INTERVAL_MS = 3_000;

function encodeSseFrame(frame: DeliveryFrame): Uint8Array {
  return new TextEncoder().encode("event: delivery\ndata: " + JSON.stringify(frame) + "\n\n");
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Durable, at-least-once scene event delivery — the transactional-
 * outbox pipeline described in scene_event.proto and the sceneManager
 * design doc. Distinct from the browser's own per-widget dispatch
 * policy (retry timeout / max-in-flight / priority — see
 * public/scene-manager/event-queue.ts): this class only answers "did
 * the browser session see this event, and did each widget it fanned
 * out to finish handling it."
 *
 * In-memory mirror of the small, mutable scene_event_deliveries
 * working-set table — nested maps keyed by sceneId then eventId then
 * instanceId, deliberately avoiding composite string keys. Hydrated
 * from the DB at startup so a restart never silently drops in-flight
 * events.
 */
export class DeliveryStore {
  private readonly open = new Map<string, Map<string, Map<string, OpenDelivery>>>();
  private readonly connections = new Map<string, Set<SseController>>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: DbClient,
    private readonly logger: Logger
  ) {}

  /**
   * Load every currently-open delivery from the DB into memory.
   * scene_event_deliveries only ever holds open rows, so this is a
   * cheap, bounded scan regardless of total event history. Call
   * before accepting any HTTP traffic.
   */
  async hydrate(): Promise<void> {
    let deliveries: Array<{ sceneEventId: string; sceneId: string; instanceId: string }>;
    try {
      const resp = await this.db.listOpenSceneEventDeliveries({ sceneId: "" });
      deliveries = resp.deliveries ?? [];
    } catch (err) {
      this.logger.warn("delivery-store: hydration failed to list open deliveries", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const eventCache = new Map<string, { type: string; key: string; value: unknown } | null>();
    for (const d of deliveries) {
      let event = eventCache.get(d.sceneEventId);
      if (event === undefined) {
        event = await this.fetchEventPayload(d.sceneEventId);
        eventCache.set(d.sceneEventId, event);
      }
      if (!event) {
        continue;
      }
      this.setOpen({
        eventId: d.sceneEventId,
        sceneId: d.sceneId,
        instanceId: d.instanceId,
        type: event.type,
        key: event.key,
        value: event.value,
        lastAttemptAt: 0,
      });
    }
    this.logger.info("delivery-store: hydrated open deliveries", { count: deliveries.length });
  }

  private async fetchEventPayload(
    sceneEventId: string
  ): Promise<{ type: string; key: string; value: unknown } | null> {
    try {
      const resp = await this.db.getSceneEvent({ id: sceneEventId });
      if (resp.status?.code !== "OK" || !resp.sceneEvent) {
        return null;
      }
      return {
        type: resp.sceneEvent.type,
        key: resp.sceneEvent.key,
        value: safeParseJson(resp.sceneEvent.value),
      };
    } catch (err) {
      this.logger.warn("delivery-store: failed to fetch parent event for hydration", {
        sceneEventId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private setOpen(delivery: OpenDelivery): void {
    let byEvent = this.open.get(delivery.sceneId);
    if (!byEvent) {
      byEvent = new Map();
      this.open.set(delivery.sceneId, byEvent);
    }
    let byInstance = byEvent.get(delivery.eventId);
    if (!byInstance) {
      byInstance = new Map();
      byEvent.set(delivery.eventId, byInstance);
    }
    byInstance.set(delivery.instanceId, delivery);
  }

  private deleteOpen(sceneId: string, eventId: string, instanceId: string): void {
    const byInstance = this.open.get(sceneId)?.get(eventId);
    byInstance?.delete(instanceId);
  }

  private *openDeliveriesFor(sceneId: string): Generator<OpenDelivery> {
    for (const byInstance of this.open.get(sceneId)?.values() ?? []) {
      for (const delivery of byInstance.values()) {
        yield delivery;
      }
    }
  }

  /**
   * Persist a new engine-triggered event and fan it out. Durability
   * first: the DB row set must exist before any push attempt, so a
   * crash between persistence and delivery is recoverable on restart.
   */
  async recordEvent(params: {
    sceneId: string;
    applicationId: string;
    type: string;
    key: string;
    value: unknown;
    targetInstanceIds: string[];
  }): Promise<string | null> {
    if (params.targetInstanceIds.length === 0) {
      return null;
    }
    let eventId: string;
    try {
      const resp = await this.db.recordSceneEvent({
        sceneId: params.sceneId,
        applicationId: params.applicationId,
        type: params.type,
        key: params.key,
        value: JSON.stringify(params.value ?? null),
        occurredAt: "",
        targetInstanceIds: params.targetInstanceIds,
      });
      if (resp.status?.code !== "OK" || !resp.sceneEvent) {
        this.logger.warn("delivery-store: recordSceneEvent did not return OK", { status: resp.status });
        return null;
      }
      eventId = resp.sceneEvent.id;
    } catch (err) {
      this.logger.warn("delivery-store: recordSceneEvent failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    for (const instanceId of params.targetInstanceIds) {
      this.setOpen({
        eventId,
        sceneId: params.sceneId,
        instanceId,
        type: params.type,
        key: params.key,
        value: params.value,
        lastAttemptAt: Date.now(),
      });
      this.push(params.sceneId, { eventId, instanceId, type: params.type, key: params.key, value: params.value });
    }
    return eventId;
  }

  /** Client acks receipt+enqueue for one or more instances of the same event. */
  async ackDelivered(sceneId: string, eventId: string, instanceIds: string[]): Promise<void> {
    for (const instanceId of instanceIds) {
      try {
        await this.db.recordSceneEventDelivery({ sceneEventId: eventId, instanceId });
      } catch (err) {
        this.logger.warn("delivery-store: recordDelivery failed", {
          sceneId,
          eventId,
          instanceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /** Client acks completion for one or more instances of the same event. */
  async ackCompleted(sceneId: string, eventId: string, instanceIds: string[]): Promise<void> {
    for (const instanceId of instanceIds) {
      try {
        await this.db.recordSceneEventCompletion({ sceneEventId: eventId, instanceId });
      } catch (err) {
        this.logger.warn("delivery-store: recordCompletion failed", {
          sceneId,
          eventId,
          instanceId,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      this.deleteOpen(sceneId, eventId, instanceId);
    }
  }

  /**
   * Register a new SSE connection for a scene. A (re)connection *is*
   * the "frontend registers to start receiving events" moment: before
   * returning, every still-open delivery for that scene is replayed
   * so a reconnect never silently loses ground.
   */
  subscribe(sceneId: string, controller: SseController): () => void {
    let sockets = this.connections.get(sceneId);
    if (!sockets) {
      sockets = new Set();
      this.connections.set(sceneId, sockets);
    }
    sockets.add(controller);

    for (const delivery of this.openDeliveriesFor(sceneId)) {
      this.sendTo(controller, {
        eventId: delivery.eventId,
        instanceId: delivery.instanceId,
        type: delivery.type,
        key: delivery.key,
        value: delivery.value,
      });
    }

    return () => {
      const set = this.connections.get(sceneId);
      set?.delete(controller);
      if (set && set.size === 0) {
        this.connections.delete(sceneId);
      }
    };
  }

  /** Every sceneId with at least one open SSE connection right now —
   *  the fan-out targeting surface (see nats-subscriptions.ts): no
   *  point loading/matching a scene nobody is watching. */
  connectedSceneIds(): string[] {
    return [...this.connections.keys()].filter((sceneId) => (this.connections.get(sceneId)?.size ?? 0) > 0);
  }

  private push(sceneId: string, frame: DeliveryFrame): void {
    for (const controller of this.connections.get(sceneId) ?? []) {
      this.sendTo(controller, frame);
    }
  }

  private sendTo(controller: SseController, frame: DeliveryFrame): void {
    try {
      controller.enqueue(encodeSseFrame(frame));
    } catch (err) {
      this.logger.warn("delivery-store: SSE push failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Background sweep: re-push any delivery whose last attempt exceeds
   * the redelivery threshold without a delivered ack. Server-driven
   * "did the browser even see this" retry — distinct from and
   * unaware of the client-side per-widget retryTimeoutMs.
   */
  startSweep(intervalMs: number = SWEEP_INTERVAL_MS): void {
    if (this.sweepTimer) {
      return;
    }
    this.sweepTimer = setInterval(() => this.sweepOnce(), intervalMs);
  }

  stopSweep(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  private sweepOnce(): void {
    const now = Date.now();
    for (const sceneId of this.open.keys()) {
      if (!this.connections.get(sceneId)?.size) {
        continue;
      }
      for (const delivery of this.openDeliveriesFor(sceneId)) {
        if (now - delivery.lastAttemptAt < REDELIVER_AFTER_MS) {
          continue;
        }
        delivery.lastAttemptAt = now;
        this.push(sceneId, {
          eventId: delivery.eventId,
          instanceId: delivery.instanceId,
          type: delivery.type,
          key: delivery.key,
          value: delivery.value,
        });
      }
    }
  }
}
