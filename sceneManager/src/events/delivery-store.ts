import type { Logger } from "@woofx3/common/runtime";
import { type DeliveryFrame, encodeStreamFrame, type StreamFrame } from "../../contract/overlay-stream";
import type { DbClient } from "../db";

interface OpenDelivery {
  eventId: string;
  sceneId: string;
  instanceId: string;
  type: string;
  key: string;
  value: unknown;
  lastAttemptAt: number;
  /**
   * When a page last said it started this delivery, or null. In memory
   * only: after a restart every page reloads and reports again.
   */
  startedAt: number | null;
  /**
   * Whether a page connected now has acknowledged queueing this delivery.
   * The sweep sends only undelivered ones again. Cleared when a page
   * subscribes, since a page that reloaded holds nothing it was sent before.
   */
  delivered: boolean;
}

/** An open delivery as a caller outside the store needs to see it. */
export interface OpenDeliveryRef {
  eventId: string;
  type: string;
  key: string;
  value: unknown;
  startedAt: number | null;
}

type SseController = ReadableStreamDefaultController<Uint8Array>;

const REDELIVER_AFTER_MS = 5_000;
const SWEEP_INTERVAL_MS = 3_000;
/** The wait before trying a failed hydration again, doubling up to the cap. */
const HYDRATE_RETRY_MIN_MS = 1_000;
const HYDRATE_RETRY_MAX_MS = 30_000;

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Durable, at-least-once scene event delivery — the transactional-
 * outbox pipeline described in scene_event.proto. Distinct from the browser's own per-widget dispatch
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
  private hydrationTimer: ReturnType<typeof setTimeout> | null = null;

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
  async hydrate(): Promise<boolean> {
    let deliveries: Array<{ sceneEventId: string; sceneId: string; instanceId: string }>;
    try {
      const resp = await this.db.listOpenSceneEventDeliveries({ sceneId: "" });
      deliveries = resp.deliveries ?? [];
    } catch (err) {
      this.logger.warn("delivery-store: hydration failed to list open deliveries", {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }

    const eventCache = new Map<string, { type: string; key: string; value: unknown } | null>();
    let hydrated = 0;
    for (const d of deliveries) {
      let event = eventCache.get(d.sceneEventId);
      if (event === undefined) {
        event = await this.fetchEventPayload(d.sceneEventId);
        eventCache.set(d.sceneEventId, event);
      }
      // One recorded since this process started is already held, and more
      // current than the row.
      if (!event || this.open.get(d.sceneId)?.get(d.sceneEventId)?.has(d.instanceId)) {
        continue;
      }
      hydrated += 1;
      this.setOpen({
        eventId: d.sceneEventId,
        sceneId: d.sceneId,
        instanceId: d.instanceId,
        type: event.type,
        key: event.key,
        value: event.value,
        lastAttemptAt: 0,
        startedAt: null,
        delivered: false,
      });
    }
    this.logger.info("delivery-store: hydrated open deliveries", { count: hydrated });
    return true;
  }

  /**
   * Hydrate, and when the database cannot be read, keep trying in the
   * background until it can: a delivery left out would never be sent again,
   * so a restart would drop it. Resolves after the first attempt, so a
   * database that is down does not hold the service back.
   */
  async startHydration(): Promise<void> {
    if (!(await this.hydrate())) {
      this.retryHydration(HYDRATE_RETRY_MIN_MS);
    }
  }

  private retryHydration(delayMs: number): void {
    this.hydrationTimer = setTimeout(async () => {
      this.hydrationTimer = null;
      if (!(await this.hydrate())) {
        this.retryHydration(Math.min(delayMs * 2, HYDRATE_RETRY_MAX_MS));
      }
    }, delayMs);
  }

  private async fetchEventPayload(sceneEventId: string): Promise<{ type: string; key: string; value: unknown } | null> {
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
    const byEvent = this.open.get(sceneId);
    const byInstance = byEvent?.get(eventId);
    if (!byEvent || !byInstance) {
      return;
    }
    byInstance.delete(instanceId);
    if (byInstance.size === 0) {
      byEvent.delete(eventId);
    }
    if (byEvent.size === 0) {
      this.open.delete(sceneId);
    }
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
        type: params.type,
        key: params.key,
        value: JSON.stringify(params.value ?? null),
        occurredAt: "",
        targetInstanceIds: params.targetInstanceIds,
      });
      if (resp.status?.code !== "OK") {
        this.logger.warn("delivery-store: recordSceneEvent did not return OK", { status: resp.status });
        return null;
      }
      if (!resp.sceneEvent) {
        this.logger.warn("delivery-store: recordSceneEvent returned OK with no scene event");
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
        startedAt: null,
        delivered: false,
      });
      this.push(params.sceneId, { eventId, instanceId, type: params.type, key: params.key, value: params.value });
    }
    return eventId;
  }

  /**
   * A page queued these instances' deliveries of an event: the sweep stops
   * sending them. Returns the instances whose delivery could not be recorded,
   * so the page sends its ack again; they still count as delivered here.
   */
  async ackDelivered(sceneId: string, eventId: string, instanceIds: string[]): Promise<string[]> {
    const failed: string[] = [];
    for (const instanceId of instanceIds) {
      const delivery = this.open.get(sceneId)?.get(eventId)?.get(instanceId);
      if (delivery) {
        delivery.delivered = true;
      }
      try {
        await this.db.recordSceneEventDelivery({ sceneEventId: eventId, instanceId });
      } catch (err) {
        failed.push(instanceId);
        this.logger.warn("delivery-store: recordDelivery failed", {
          sceneId,
          eventId,
          instanceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return failed;
  }

  /**
   * A page finished an event on these instances. Returns the deliveries this
   * closed, so the caller can record what finished, and the instances whose
   * completion could not be recorded: those stay open, and the page sends its
   * ack again. A delivery already closed -- cancelled by a skip, or acked by
   * another page -- is not returned: its end has been recorded by whoever
   * closed it.
   */
  async ackCompleted(
    sceneId: string,
    eventId: string,
    instanceIds: string[]
  ): Promise<{ closed: OpenDeliveryRef[]; failed: string[] }> {
    const closed: OpenDeliveryRef[] = [];
    const failed: string[] = [];
    for (const instanceId of instanceIds) {
      const delivery = this.open.get(sceneId)?.get(eventId)?.get(instanceId);
      try {
        await this.db.recordSceneEventCompletion({ sceneEventId: eventId, instanceId });
      } catch (err) {
        failed.push(instanceId);
        this.logger.warn("delivery-store: recordCompletion failed", {
          sceneId,
          eventId,
          instanceId,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      // Closed only if it is still the delivery this ack found: a skip, or
      // another page's ack, may have closed it during the write and recorded
      // its end already.
      if (!delivery || this.open.get(sceneId)?.get(eventId)?.get(instanceId) !== delivery) {
        continue;
      }
      this.deleteOpen(sceneId, eventId, instanceId);
      closed.push({
        eventId,
        type: delivery.type,
        key: delivery.key,
        value: delivery.value,
        startedAt: delivery.startedAt,
      });
    }
    return { closed, failed };
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

    const openSet: Record<string, string[]> = {};
    for (const delivery of this.openDeliveriesFor(sceneId)) {
      (openSet[delivery.instanceId] ??= []).push(delivery.eventId);
      // The page may be one that just reloaded, holding none of it: until it
      // says it queued the delivery again, the sweep keeps sending it, from
      // a full interval after this replay.
      delivery.delivered = false;
      delivery.lastAttemptAt = Date.now();
      this.sendTo(controller, {
        eventId: delivery.eventId,
        instanceId: delivery.instanceId,
        type: delivery.type,
        key: delivery.key,
        value: delivery.value,
      });
    }
    // After the replay, so the page knows the whole set: what it still holds
    // beyond it was closed while its stream was down.
    try {
      controller.enqueue(
        new TextEncoder().encode(encodeStreamFrame({ kind: "open-set", frame: { deliveries: openSet } }))
      );
    } catch (err) {
      this.logger.warn("delivery-store: SSE push failed", {
        event: "open-set",
        error: err instanceof Error ? err.message : String(err),
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

  /**
   * Close every open delivery of a scene addressed to a placement not in
   * `present`: one removed after the delivery was recorded, which no page
   * will ever register a queue for. Returns how many were closed.
   */
  async closeAbsent(sceneId: string, present: ReadonlySet<string>): Promise<number> {
    const absent = new Map<string, string[]>();
    for (const delivery of this.openDeliveriesFor(sceneId)) {
      if (!present.has(delivery.instanceId)) {
        let eventIds = absent.get(delivery.instanceId);
        if (!eventIds) {
          eventIds = [];
          absent.set(delivery.instanceId, eventIds);
        }
        eventIds.push(delivery.eventId);
      }
    }
    let closed = 0;
    const writes: Promise<void>[] = [];
    for (const [instanceId, eventIds] of absent) {
      closed += eventIds.length;
      writes.push(this.cancel(sceneId, instanceId, eventIds));
    }
    await Promise.all(writes);
    return closed;
  }

  /** Scenes holding at least one open delivery. */
  scenesWithOpenDeliveries(): string[] {
    return [...this.open.keys()];
  }

  /**
   * A scene's open deliveries of one `type`, grouped by target instance,
   * each group oldest first.
   */
  openDeliveriesByInstance(sceneId: string, type: string): Map<string, OpenDeliveryRef[]> {
    const byInstance = new Map<string, OpenDeliveryRef[]>();
    for (const delivery of this.openDeliveriesFor(sceneId)) {
      if (delivery.type !== type) {
        continue;
      }
      let group = byInstance.get(delivery.instanceId);
      if (!group) {
        group = [];
        byInstance.set(delivery.instanceId, group);
      }
      group.push({
        eventId: delivery.eventId,
        type: delivery.type,
        key: delivery.key,
        value: delivery.value,
        startedAt: delivery.startedAt,
      });
    }
    return byInstance;
  }

  /**
   * A page started playing an event on these instances. Returns the
   * deliveries this is the first start report for, so the caller can
   * record the start once however many pages report it.
   */
  markStarted(sceneId: string, eventId: string, instanceIds: string[], now: number = Date.now()): OpenDeliveryRef[] {
    const byInstance = this.open.get(sceneId)?.get(eventId);
    const firsts: OpenDeliveryRef[] = [];
    for (const instanceId of instanceIds) {
      const delivery = byInstance?.get(instanceId);
      if (!delivery) {
        continue;
      }
      if (delivery.startedAt === null) {
        firsts.push({ eventId, type: delivery.type, key: delivery.key, value: delivery.value, startedAt: now });
      }
      delivery.startedAt = now;
    }
    return firsts;
  }

  /**
   * Close deliveries to one instance without waiting for a page to finish
   * them, and tell every open page of the scene to drop them.
   *
   * Everything a later request could observe happens before this returns:
   * the deliveries leave the open set and the cancel frame is pushed. Only
   * the db writes are left in the returned promise, so callers can close
   * many instances in one synchronous pass and a concurrent request plans
   * against the result rather than a half-applied one. The writes record
   * the deliveries as completed, which is what ends redelivery after a
   * restart; scene_event_log therefore shows a cancelled delivery as
   * `completed`, and the reason it ended is the caller's to record.
   */
  cancel(sceneId: string, instanceId: string, eventIds: string[]): Promise<void> {
    if (eventIds.length === 0) {
      return Promise.resolve();
    }
    for (const eventId of eventIds) {
      this.deleteOpen(sceneId, eventId, instanceId);
    }
    this.broadcast(sceneId, { kind: "cancel", frame: { instanceId, eventIds } });
    return Promise.all(
      eventIds.map(async (eventId) => {
        try {
          await this.db.recordSceneEventCompletion({ sceneEventId: eventId, instanceId });
        } catch (err) {
          this.logger.warn("delivery-store: recording a cancelled delivery failed", {
            sceneId,
            eventId,
            instanceId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })
    ).then(() => undefined);
  }

  /** Every sceneId with at least one open SSE connection right now —
   *  the fan-out targeting surface (see nats-subscriptions.ts): no
   *  point loading/matching a scene nobody is watching. */
  connectedSceneIds(): string[] {
    return [...this.connections.keys()].filter((sceneId) => (this.connections.get(sceneId)?.size ?? 0) > 0);
  }

  /**
   * Push a named frame to every open connection of a scene. Unlike a
   * delivery it is not recorded, acked or redelivered: it carries state
   * the page can ask for again, not an event it must not miss.
   */
  broadcast(sceneId: string, frame: StreamFrame): void {
    const bytes = new TextEncoder().encode(encodeStreamFrame(frame));
    for (const controller of this.connections.get(sceneId) ?? []) {
      try {
        controller.enqueue(bytes);
      } catch (err) {
        this.logger.warn("delivery-store: SSE push failed", {
          event: frame.kind,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private push(sceneId: string, frame: DeliveryFrame): void {
    for (const controller of this.connections.get(sceneId) ?? []) {
      this.sendTo(controller, frame);
    }
  }

  private sendTo(controller: SseController, frame: DeliveryFrame): void {
    try {
      controller.enqueue(new TextEncoder().encode(encodeStreamFrame({ kind: "delivery", frame })));
    } catch (err) {
      this.logger.warn("delivery-store: SSE push failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Background sweep: re-push any undelivered delivery whose last attempt
   * exceeds the redelivery threshold. Server-driven
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
    if (this.hydrationTimer) {
      clearTimeout(this.hydrationTimer);
      this.hydrationTimer = null;
    }
  }

  private sweepOnce(): void {
    const now = Date.now();
    for (const sceneId of this.open.keys()) {
      if (!this.connections.get(sceneId)?.size) {
        continue;
      }
      for (const delivery of this.openDeliveriesFor(sceneId)) {
        if (delivery.delivered || now - delivery.lastAttemptAt < REDELIVER_AFTER_MS) {
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
