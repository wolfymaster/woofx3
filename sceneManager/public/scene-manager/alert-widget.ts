// Plays alerts inside an alert widget's area on the scene. An alert widget
// has no frame of its own: each alert is a composition, which the page plays
// on a stage in the area (alert-stage.ts). The event queue holds the next
// alert until this one finishes, so an alert widget plays one alert at a time.
//
// Alerts are played on prepared alerts (prepared-alert.ts): an alert's stage
// and frames are built hidden, and boot, before it is due. Which shapes are
// kept prepared is worked out from the queue each time it may have changed:
// first the shapes of the alerts waiting in it, in the order they will play,
// so an alert's frames boot while it waits its turn; then, only while nothing
// is on screen, the shapes played most recently, so the next alert of a shape
// finds frames ready without preparing ever taking time from one on screen.
// When the pool is full the stage needed latest makes room, and a shape due
// later than every stage kept is not prepared. An alert whose prepared frames
// cannot take its settings is prepared again and played at once, as if none
// had been ready.

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
 * How many prepared alerts an alert widget keeps, one per shape. Each holds a
 * frame per widget of its alert, booted and idle; a stream's alerts usually
 * come in a handful of shapes (follow, subscription, raid, ...), each kept
 * ready at this size.
 */
export const DEFAULT_PREPARED_ALERTS = 4;

export interface AlertWidgetOptions {
  /** The alert widget's area on the scene. */
  element: HTMLElement;
  /** The area's placement id, which names its marks (alert-timing.ts). */
  instanceId: string;
  /** Every live bridge on the page; inbound messages are routed through it. */
  bridges: Set<WidgetBridge>;
  /** `moduleId` is the alert layout placement's, never the widget's claim. */
  postStatus(instanceId: string, moduleId: string, report: WidgetStatusReportPayload): void;
  /** The page's file cache, which the alert's widgets read through. */
  assets: AssetCache;
  /** The alert delivered as `eventId` is over; the queue may start the next. */
  onFinished(eventId: string): void;
  /** The alerts waiting in the area's queue, in the order they will play. */
  waiting(): readonly QueuedEvent[];
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
  /** Alerts prepared for what is due, by shape, oldest first. */
  private readonly prepared = new Map<string, PreparedAlert>();
  /**
   * The latest delivery of each shape played, by shape, most recent last and
   * at most `capacity` of them: what an idle area prepares its shapes from.
   */
  private readonly played = new Map<string, AlertDelivery>();
  private readonly capacity: number;
  private nextPreparedId = 1;
  private preparing: unknown = null;
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
    this.playing.get(eventId)?.();
    this.schedulePreparing();
  }

  /**
   * Take every alert off screen and report each finished, for an area leaving
   * the page: nothing would ever finish them otherwise, and the server would
   * hold them on screen until they time out. Drops every prepared alert.
   */
  dispose(): void {
    this.disposed = true;
    if (this.preparing !== null) {
      this.opts.host.timers.clearTimeout(this.preparing);
      this.preparing = null;
    }
    for (const prepared of this.prepared.values()) {
      prepared.stop();
    }
    this.prepared.clear();
    this.played.clear();
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
   * Alert `eventId` reached the page: mark when and start reading the files
   * its widgets will ask for. What to prepare is decided once the queue has
   * taken it, or dropped it as a repeat.
   */
  delivered(eventId: string, value: unknown): void {
    this.opts.timings.alert(eventId, this.opts.instanceId, "delivered");
    const delivery = parseAlertDelivery(value);
    if (delivery && !this.playing.has(eventId)) {
      readAheadAlertAssets(this.opts.assets, delivery);
      this.schedulePreparing();
    }
  }

  private run(eventId: string, delivery: AlertDelivery): void {
    const { timings, instanceId: areaId } = this.opts;
    readAheadAlertAssets(this.opts.assets, delivery);
    const shape = alertShape(delivery);
    const ready = this.prepared.get(shape);
    this.prepared.delete(shape);
    let alert: PreparedAlert;
    if (ready?.adopt(delivery) === true) {
      timings.alert(eventId, areaId, "prepared");
      alert = ready;
    } else {
      ready?.stop();
      alert = this.build(delivery);
    }
    this.rememberPlayed(shape, delivery);
    // Every way off the stage passes through here once: playing out, a
    // stop (skip, cancel) and the area's dispose. A stopped alert never
    // reports finishing, and a finished one is no longer in `playing`.
    const leave = (): void => {
      this.playing.delete(eventId);
      alert.stop();
      timings.alert(eventId, areaId, "finished");
    };
    this.playing.set(eventId, leave);
    alert.start(eventId, delivery, () => {
      leave();
      this.opts.onFinished(eventId);
      this.schedulePreparing();
    });
    this.schedulePreparing();
  }

  private rememberPlayed(shape: string, delivery: AlertDelivery): void {
    this.played.delete(shape);
    this.played.set(shape, delivery);
    for (const oldest of this.played.keys()) {
      if (this.played.size <= this.capacity) {
        break;
      }
      this.played.delete(oldest);
    }
  }

  /**
   * Prepare once the current task is done: the queue takes a delivery after
   * `delivered`, and starts the next alert after an alert's `onFinished`, so
   * only then does it say what is waiting and whether anything is on screen.
   */
  private schedulePreparing(): void {
    if (this.disposed || this.capacity === 0 || this.preparing !== null) {
      return;
    }
    this.preparing = this.opts.host.timers.setTimeout(() => {
      this.preparing = null;
      this.prepareWanted();
    }, 0);
  }

  /** Prepare the shapes wanted soonest, making room by dropping the stage wanted latest. */
  private prepareWanted(): void {
    if (this.disposed) {
      return;
    }
    const wanted = this.wantedShapes();
    const rank = new Map([...wanted.keys()].map((shape, index) => [shape, index]));
    let index = 0;
    for (const [shape, delivery] of wanted) {
      if (!this.prepared.has(shape)) {
        if (this.prepared.size >= this.capacity && !this.dropPreparedAfter(index, rank)) {
          return;
        }
        this.prepared.set(shape, this.build(delivery));
      }
      index += 1;
    }
  }

  /**
   * The shapes to keep prepared, soonest wanted first, each with a delivery
   * to prepare it from: the waiting alerts' shapes in the order they play,
   * then, when nothing is on screen, the shapes played most recently. At most
   * `capacity` of them, since a shape ranked after that many is never
   * prepared, so a long queue (a burst of gifted subs) is read only as far as
   * the pool reaches.
   */
  private wantedShapes(): Map<string, AlertDelivery> {
    const wanted = new Map<string, AlertDelivery>();
    for (const item of this.opts.waiting()) {
      if (wanted.size >= this.capacity) {
        return wanted;
      }
      const delivery = parseAlertDelivery(item.value);
      if (delivery === null) {
        continue;
      }
      const shape = alertShape(delivery);
      if (!wanted.has(shape)) {
        wanted.set(shape, delivery);
      }
    }
    if (this.playing.size === 0) {
      for (const [shape, delivery] of [...this.played].reverse()) {
        if (wanted.size >= this.capacity) {
          break;
        }
        if (!wanted.has(shape)) {
          wanted.set(shape, delivery);
        }
      }
    }
    return wanted;
  }

  /**
   * Drop the prepared alert wanted latest, an unwanted one first and the
   * oldest of those, when it is wanted later than position `index`. False,
   * and nothing dropped, when every prepared alert is wanted sooner.
   */
  private dropPreparedAfter(index: number, rank: ReadonlyMap<string, number>): boolean {
    let latest: string | null = null;
    let latestRank = -1;
    for (const shape of this.prepared.keys()) {
      const shapeRank = rank.get(shape) ?? Number.POSITIVE_INFINITY;
      if (shapeRank > latestRank) {
        latest = shape;
        latestRank = shapeRank;
      }
    }
    if (latest === null || latestRank <= index) {
      return false;
    }
    this.prepared.get(latest)?.stop();
    this.prepared.delete(latest);
    return true;
  }

  private build(delivery: AlertDelivery): PreparedAlert {
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
