// The alert areas on an overlay page: placements the page draws itself,
// each playing the alerts delivered to it one at a time through its queue,
// and acknowledging each as it starts and finishes.

import type { SchedulerClock } from "@woofx3/scene/runtime";
import {
  type AssetCache,
  BROWSER_HOST,
  type EventQueueManager,
  type PageHost,
  type QueueRegistration,
  type WidgetBridge,
  type WidgetStatusReportPayload,
} from "@woofx3/widget-host/page";
import { AlertTimings, BROWSER_MARKS } from "./alert-timing";
import { AlertWidget, type AlertWidgetOptions } from "./alert-widget";
import { PAGE_CLOCK } from "./page-clock";

/** What the page plays an area's alerts with: an `AlertWidget`. */
export type AlertArea = Pick<AlertWidget, "play" | "stop" | "dispose" | "delivered">;

export interface AlertAreasDeps {
  /** Where an area's element, and its alerts' stages and frames, are made. */
  document: Document;
  bridges: Set<WidgetBridge>;
  queues: EventQueueManager;
  assets: AssetCache;
  postStatus(instanceId: string, moduleId: string, report: WidgetStatusReportPayload): void;
  /**
   * Acknowledge an alert starting or finishing, one request each rather than
   * through a batcher: the server finds the alert on screen from these, and a
   * quarter-second batch is long enough for an operator's Skip to land on the
   * alert that just ended.
   */
  ackAlert(kind: "started" | "completed", eventId: string, instanceId: string): void;
  /** The area is in the page and drawn. */
  rendered(instanceId: string): void;
  /** Builds an area's player; an `AlertWidget` unless a test stands one in. */
  createArea?(options: AlertWidgetOptions): AlertArea;
  /** What alerts play on; the page clock (page-clock.ts) when absent. */
  clock?: SchedulerClock<unknown>;
  host?: PageHost;
  /** Where alerts' steps are marked; the browser's User Timing when absent. */
  timings?: AlertTimings;
}

export class AlertAreas {
  private readonly areas = new Map<string, AlertArea>();
  private readonly timings: AlertTimings;

  constructor(private readonly deps: AlertAreasDeps) {
    this.timings = deps.timings ?? new AlertTimings(BROWSER_MARKS);
  }

  /** Draw the alert area for placement `instanceId` in `slot`; the result removes it. */
  mount(instanceId: string, slot: HTMLElement): () => void {
    const { deps } = this;
    const element = deps.document.createElement("div");
    element.className = "alert-widget";
    slot.appendChild(element);

    // The page plays alerts itself, so it registers the queue a framed
    // widget would register on subscribe: one alert at a time.
    let registration: QueueRegistration | null = null;
    // Set as the area is torn down: finishing what it plays must not start
    // the next alert on an area that is going away.
    let disposing = false;
    const area = (deps.createArea ?? ((options) => new AlertWidget(options)))({
      element,
      bridges: deps.bridges,
      postStatus: deps.postStatus,
      assets: deps.assets,
      document: deps.document,
      clock: deps.clock ?? PAGE_CLOCK,
      host: deps.host ?? BROWSER_HOST,
      timings: this.timings,
      onFinished: (eventId) => {
        if (registration !== null) {
          deps.queues.complete(registration, eventId);
        }
        deps.ackAlert("completed", eventId, instanceId);
      },
      waiting: () => (registration === null ? [] : deps.queues.pending(registration)),
    });
    this.areas.set(instanceId, area);
    registration = deps.queues.register(
      instanceId,
      { maxInFlight: 1 },
      (item) => {
        if (disposing) {
          return false;
        }
        deps.ackAlert("started", item.eventId, instanceId);
        return area.play(item);
      },
      () => {},
      (eventId) => area.stop(eventId)
    );
    // The page draws the area itself, so it has painted as soon as it is in
    // the page. Reported once the runtime's current update is done.
    queueMicrotask(() => deps.rendered(instanceId));

    return () => {
      disposing = true;
      // Finishes what is playing while the queue is still there to hear it.
      area.dispose();
      if (this.areas.get(instanceId) === area) {
        this.areas.delete(instanceId);
      }
      if (registration !== null) {
        deps.queues.unregister(registration);
        registration = null;
      }
      element.remove();
    };
  }

  /** Alert `eventId` was delivered to placement `instanceId`; nothing happens when that is not an alert area. */
  delivered(instanceId: string, eventId: string, value: unknown): void {
    this.areas.get(instanceId)?.delivered(eventId, value);
  }
}
