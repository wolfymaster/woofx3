// Plays alert layouts inside an alert widget's area on the scene. An alert
// widget has no frame of its own: for each alert, the page frames the
// layout's widgets inside the area, scaled from the layout's canvas to fit,
// and removes them once the alert is over (see alert-timeline.ts). The
// event queue holds the next alert until this one finishes, so an alert
// widget plays one alert at a time.

import type { WidgetEvent } from "@woofx3/module-sdk";
import { AlertTimeline } from "./alert-timeline";
import type { QueuedEvent } from "./event-queue";
import { createFrameLoadHandler, WidgetBridge, type WidgetStatusReportPayload } from "./widget-bridge";

const TICK_MS = 250;

interface Position {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The slice of the server's `AlertDelivery` the page needs. */
interface AlertDelivery {
  layout: { width: number; height: number; widgets: Array<{ id: string; position: Position }> };
  event: { type: string; data: unknown } | null;
}

export interface AlertWidgetOptions {
  /** The alert widget's area on the scene. */
  element: HTMLElement;
  sceneBase: string;
  /** Every live bridge on the page; inbound messages are routed through it. */
  bridges: Set<WidgetBridge>;
  generateNonce(): string;
  postStatus(instanceId: string, report: WidgetStatusReportPayload): void;
  /** The alert delivered as `eventId` is over; the queue may start the next. */
  onFinished(eventId: string): void;
}

export class AlertWidget {
  constructor(private readonly opts: AlertWidgetOptions) {}

  /**
   * Start one alert. Always accepts the delivery: one that cannot be played
   * still has to finish, or the server redelivers it forever.
   */
  play(item: QueuedEvent): boolean {
    const delivery = parseDelivery(item.value);
    if (!delivery) {
      console.warn("[scene-manager] malformed alert delivery; skipping", { eventId: item.eventId });
      setTimeout(() => this.opts.onFinished(item.eventId), 0);
      return true;
    }
    this.run(item.eventId, delivery);
    return true;
  }

  private run(eventId: string, delivery: AlertDelivery): void {
    const { element, sceneBase, bridges } = this.opts;
    const { layout } = delivery;

    const stage = document.createElement("div");
    stage.className = "alert-stage";
    stage.style.width = `${layout.width}px`;
    stage.style.height = `${layout.height}px`;
    const scale = Math.min(element.clientWidth / layout.width, element.clientHeight / layout.height);
    const offsetX = (element.clientWidth - layout.width * scale) / 2;
    const offsetY = (element.clientHeight - layout.height * scale) / 2;
    stage.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    element.appendChild(stage);

    const timeline = new AlertTimeline(
      layout.widgets.map((widget) => widget.id),
      Date.now()
    );
    const alertEvent: WidgetEvent = {
      type: "alert",
      source: "scene-manager",
      time: new Date().toISOString(),
      data: delivery.event,
      eventId,
    };

    const children: WidgetBridge[] = [];
    for (const widget of layout.widgets) {
      const instanceId = `${eventId}.${widget.id}`;
      const nonce = this.opts.generateNonce();
      const iframe = document.createElement("iframe");
      iframe.className = "widget-frame";
      iframe.style.left = `${widget.position.x}px`;
      iframe.style.top = `${widget.position.y}px`;
      iframe.style.width = `${widget.position.width}px`;
      iframe.style.height = `${widget.position.height}px`;
      iframe.setAttribute("sandbox", "allow-scripts");

      const bridge: WidgetBridge = new WidgetBridge(instanceId, nonce, {
        onStorageGet: () => null,
        onStorageSubscribe: () => {},
        onStorageUnsubscribe: () => {},
        onStatusReport: (report) => this.opts.postStatus(instanceId, report),
        onEventsSubscribe: (subId, queue) => {
          timeline.subscribed(widget.id, queue?.autoComplete === false);
          bridge.sendEvent(subId, alertEvent);
        },
        onEventsUnsubscribe: () => {},
        onEventComplete: () => timeline.completed(widget.id),
        onDispose: () => {},
      });
      iframe.addEventListener("load", createFrameLoadHandler(bridge));
      iframe.src =
        `${sceneBase}/alert/${encodeURIComponent(eventId)}/widget/${encodeURIComponent(widget.id)}` +
        `?nonce=${encodeURIComponent(nonce)}`;

      bridges.add(bridge);
      stage.appendChild(iframe);
      bridge.attach(iframe);
      children.push(bridge);
    }

    const timer = setInterval(() => {
      if (!timeline.isOver(Date.now())) {
        return;
      }
      clearInterval(timer);
      for (const bridge of children) {
        bridge.dispose();
        bridge.detach();
        bridges.delete(bridge);
      }
      stage.remove();
      this.opts.onFinished(eventId);
    }, TICK_MS);
  }
}

function parseDelivery(value: unknown): AlertDelivery | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { layout, event } = value as Partial<AlertDelivery>;
  if (!layout || !(layout.width > 0) || !(layout.height > 0) || !Array.isArray(layout.widgets)) {
    return null;
  }
  return { layout, event: event ?? null };
}
