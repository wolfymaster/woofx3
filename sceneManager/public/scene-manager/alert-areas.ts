// The alert areas on an overlay page: placements the page draws itself,
// each playing the alerts delivered to it one at a time through its queue,
// and acknowledging each as it starts and finishes.

import type { SchedulerClock } from "@woofx3/scene/runtime";
import { AlertWidget, type AlertWidgetOptions } from "./alert-widget";
import type { AssetCache } from "./asset-loader";
import type { EventQueueManager, QueueRegistration } from "./event-queue";
import { PAGE_CLOCK } from "./page-clock";
import { BROWSER_HOST, type PageHost } from "./page-host";
import type { WidgetBridge, WidgetStatusReportPayload } from "./widget-bridge";

/** What the page plays an area's alerts with: an `AlertWidget`. */
export type AlertArea = Pick<AlertWidget, "play" | "stop" | "dispose" | "readAhead">;

export interface AlertAreasDeps {
  /** Where an area's element, and its alerts' stages and frames, are made. */
  document: Document;
  /** `/scene/{sceneId}`. */
  sceneBase: string;
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
}

export class AlertAreas {
  private readonly areas = new Map<string, AlertArea>();

  constructor(private readonly deps: AlertAreasDeps) {}

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
      sceneBase: deps.sceneBase,
      bridges: deps.bridges,
      postStatus: deps.postStatus,
      assets: deps.assets,
      document: deps.document,
      clock: deps.clock ?? PAGE_CLOCK,
      host: deps.host ?? BROWSER_HOST,
      onFinished: (eventId) => {
        if (registration !== null) {
          deps.queues.complete(registration, eventId);
        }
        deps.ackAlert("completed", eventId, instanceId);
      },
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

  /** An alert delivered to placement `instanceId`: start reading its files before its turn. */
  readAhead(instanceId: string, value: unknown): void {
    this.areas.get(instanceId)?.readAhead(value);
  }
}
