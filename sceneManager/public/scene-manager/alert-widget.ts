// Plays alerts inside an alert widget's area on the scene. An alert widget
// has no frame of its own: each alert is a composition, which the page plays
// on a stage in the area (alert-stage.ts). The event queue holds the next
// alert until this one finishes, so an alert widget plays one alert at a time.
//
// Alerts are played on prepared alerts (prepared-alert.ts): an alert's stage
// and frames are built hidden, and boot, before it is due. The first alert of
// a shape is prepared as it is delivered, so its frames boot while it waits
// its turn; once an alert of a shape has played, another of that shape is
// prepared for the next one: at once when one is already waiting, else after
// it finishes, so preparing for an alert nobody is waiting on never takes time
// from one on screen. An alert whose prepared frames cannot take its settings
// is prepared again and played at once, as if none had been ready.

import { moduleIdOfCanonicalId } from "@woofx3/scene/model";
import type { SchedulerClock } from "@woofx3/scene/runtime";
import type {
  AssetCache,
  PageHost,
  QueuedEvent,
  WidgetBridge,
  WidgetStatusReportPayload,
} from "@woofx3/widget-host/page";
import { type AlertDelivery, parseAlertDelivery } from "../../contract/alert-delivery";
import type { AlertTimings } from "./alert-timing";
import { alertShape, PreparedAlert } from "./prepared-alert";

/**
 * How many prepared alerts an alert widget keeps, one per shape, the least
 * recently wanted dropped first. Each holds a frame per widget of its alert,
 * booted and idle; a stream's alerts usually come in a handful of shapes
 * (follow, subscription, raid, ...), each kept ready at this size.
 */
export const DEFAULT_PREPARED_ALERTS = 4;

export interface AlertWidgetOptions {
  /** The alert widget's area on the scene. */
  element: HTMLElement;
  /** Every live bridge on the page; inbound messages are routed through it. */
  bridges: Set<WidgetBridge>;
  /** `moduleId` is the alert layout placement's, never the widget's claim. */
  postStatus(instanceId: string, moduleId: string, report: WidgetStatusReportPayload): void;
  /** The page's file cache, which the alert's widgets read through. */
  assets: AssetCache;
  /** The alert delivered as `eventId` is over; the queue may start the next. */
  onFinished(eventId: string): void;
  /** Where the alert's stage and frames are made: the page's document. */
  document: Document;
  /** What alerts play on (page-clock.ts). */
  clock: SchedulerClock<unknown>;
  host: PageHost;
  /** Where each step of an alert is marked (alert-timing.ts). */
  timings: AlertTimings;
  /** See `DEFAULT_PREPARED_ALERTS`; 0 prepares each alert only as it plays. */
  preparedAlerts?: number;
}

export class AlertWidget {
  /** Tear-down for each alert on screen, by event id. */
  private readonly playing = new Map<string, () => void>();
  /** Alerts prepared for what is due next, by shape, least recently wanted first. */
  private readonly prepared = new Map<string, PreparedAlert>();
  /** The shape of each alert delivered and not yet played or cancelled, by event id. */
  private readonly waiting = new Map<string, string>();
  private readonly capacity: number;
  private nextPreparedId = 1;
  private disposed = false;

  constructor(private readonly opts: AlertWidgetOptions) {
    this.capacity = opts.preparedAlerts ?? DEFAULT_PREPARED_ALERTS;
    if (!Number.isInteger(this.capacity) || this.capacity < 0) {
      throw new Error("AlertWidget: preparedAlerts must be a non-negative integer");
    }
  }

  /**
   * Take an alert off screen now. Does not report it finished: it was
   * cancelled on the server, which has already closed its delivery.
   */
  stop(eventId: string): void {
    this.waiting.delete(eventId);
    this.playing.get(eventId)?.();
  }

  /**
   * Take every alert off screen and report each finished, for an area leaving
   * the page: nothing would ever finish them otherwise, and the server would
   * hold them on screen until they time out. Drops every prepared alert.
   */
  dispose(): void {
    this.disposed = true;
    for (const prepared of this.prepared.values()) {
      prepared.stop();
    }
    this.prepared.clear();
    this.waiting.clear();
    for (const [eventId, tearDown] of [...this.playing]) {
      tearDown();
      this.opts.onFinished(eventId);
    }
  }

  /**
   * Start one alert. Always accepts the delivery: one that cannot be played
   * still has to finish, or the server redelivers it forever.
   */
  play(item: QueuedEvent): boolean {
    const delivery = parseAlertDelivery(item.value);
    if (!delivery) {
      this.opts.host.log.warn("[scene-manager] malformed alert delivery; skipping", { eventId: item.eventId });
      this.opts.host.timers.setTimeout(() => this.opts.onFinished(item.eventId), 0);
      return true;
    }
    this.run(item.eventId, delivery);
    return true;
  }

  /**
   * Alert `eventId` reached the page: mark when, start reading the files its
   * widgets will ask for, and prepare it if nothing of its shape is ready, so
   * its frames boot while it waits for its turn.
   */
  delivered(eventId: string, value: unknown): void {
    this.opts.timings.alert(eventId, "delivered");
    const delivery = parseAlertDelivery(value);
    if (delivery && !this.playing.has(eventId)) {
      readAheadAlertAssets(this.opts.assets, delivery);
      this.waiting.set(eventId, alertShape(delivery));
      this.prepareShapeOf(delivery);
    }
  }

  private run(eventId: string, delivery: AlertDelivery): void {
    readAheadAlertAssets(this.opts.assets, delivery);
    const shape = alertShape(delivery);
    this.waiting.delete(eventId);
    const ready = this.prepared.get(shape);
    this.prepared.delete(shape);
    let alert: PreparedAlert;
    if (ready?.adopt(delivery) === true) {
      this.opts.timings.alert(eventId, "prepared");
      alert = ready;
    } else {
      ready?.stop();
      alert = this.prepare(delivery);
    }
    this.playing.set(eventId, () => {
      this.playing.delete(eventId);
      alert.stop();
    });
    alert.start(eventId, delivery, () => {
      this.opts.timings.alert(eventId, "finished");
      this.playing.delete(eventId);
      this.opts.onFinished(eventId);
      // Ready the next alert of this shape now that nothing of this one is on
      // screen for the preparing to take time from.
      this.opts.host.timers.setTimeout(() => this.prepareShapeOf(delivery), 0);
    });
    if ([...this.waiting.values()].includes(shape)) {
      this.opts.host.timers.setTimeout(() => this.prepareShapeOf(delivery), 0);
    }
  }

  /** Prepare an alert of `delivery`'s shape unless one is ready, making room for it. */
  private prepareShapeOf(delivery: AlertDelivery): void {
    if (this.disposed || this.capacity === 0) {
      return;
    }
    const shape = alertShape(delivery);
    const ready = this.prepared.get(shape);
    if (ready !== undefined) {
      // Wanted again: to the back, the last to be dropped.
      this.prepared.delete(shape);
      this.prepared.set(shape, ready);
      return;
    }
    while (this.prepared.size >= this.capacity) {
      const [oldestShape, oldest] = this.prepared.entries().next().value as [string, PreparedAlert];
      this.prepared.delete(oldestShape);
      oldest.stop();
    }
    this.prepared.set(shape, this.prepare(delivery));
  }

  private prepare(delivery: AlertDelivery): PreparedAlert {
    const id = `prepared-${this.nextPreparedId}`;
    this.nextPreparedId += 1;
    return new PreparedAlert(this.opts, delivery, id);
  }
}

function readAheadAlertAssets(assets: AssetCache, delivery: AlertDelivery): void {
  for (const placement of Object.values(delivery.layout.widgets)) {
    assets.warm(moduleIdOfCanonicalId(placement.widget), placement.settings);
  }
}
