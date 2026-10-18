// The alert areas on an overlay page: placements the page draws itself,
// each playing the alerts delivered to it one at a time through its queue,
// and acknowledging each as it starts and finishes.

import { AlertWidget } from "./alert-widget";
import type { AssetCache } from "./asset-loader";
import type { EventQueueManager, QueueRegistration } from "./event-queue";
import type { WidgetBridge, WidgetStatusReportPayload } from "./widget-bridge";

export interface AlertAreasDeps {
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
}

export class AlertAreas {
  private readonly areas = new Map<string, AlertWidget>();

  constructor(private readonly deps: AlertAreasDeps) {}

  /** Draw the alert area for placement `instanceId` in `slot`; the result removes it. */
  mount(instanceId: string, slot: HTMLElement): () => void {
    const { deps } = this;
    const element = document.createElement("div");
    element.className = "alert-widget";
    slot.appendChild(element);

    // The page plays alerts itself, so it registers the queue a framed
    // widget would register on subscribe: one alert at a time.
    let registration: QueueRegistration | null = null;
    const area = new AlertWidget({
      element,
      sceneBase: deps.sceneBase,
      bridges: deps.bridges,
      postStatus: deps.postStatus,
      assets: deps.assets,
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
      // Finishes what is playing while the queue is still there to hear it.
      area.dispose();
      this.areas.delete(instanceId);
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
