// Plays alert layouts inside an alert widget's area on the scene. An alert
// widget has no frame of its own: for each alert, the page frames the
// layout's widgets inside the area, scaled from the layout's canvas to fit,
// and removes them once the alert is over (see alert-timeline.ts). The
// event queue holds the next alert until this one finishes, so an alert
// widget plays one alert at a time.
//
// Each layout widget enters with its `transitionIn` as it first paints. A
// widget with a length of its own leaves with its `transitionOut` once it
// completes; the rest leave together when the alert is over, and the alert
// is reported finished only once they are gone.

import { type PlacementTransition, type WidgetEvent, isGenericTransitionType } from "@woofx3/module-sdk";
import { AlertTimeline } from "./alert-timeline";
import type { QueuedEvent } from "./event-queue";
import { TransitionAnimator, type TransitionTarget } from "./transitions";
import { createFrameLoadHandler, WidgetBridge, type WidgetStatusReportPayload } from "./widget-bridge";

const TICK_MS = 250;

/** A generic entrance waits for the frame's first paint, but not longer than this. */
const ENTRANCE_WAIT_MS = 2000;

interface Position {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The slice of the server's `AlertDelivery` the page needs. */
interface AlertDelivery {
  layout: {
    width: number;
    height: number;
    widgets: Array<{
      id: string;
      position: Position;
      transitionIn?: PlacementTransition;
      transitionOut?: PlacementTransition;
    }>;
  };
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
  /** Tear-down for each alert on screen, by event id. */
  private readonly playing = new Map<string, () => void>();
  private readonly animator = new TransitionAnimator();

  constructor(private readonly opts: AlertWidgetOptions) {}

  /**
   * Take an alert off screen now. Does not report it finished: it was
   * cancelled on the server, which has already closed its delivery.
   */
  stop(eventId: string): void {
    this.playing.get(eventId)?.();
  }

  /**
   * Take every alert off screen and report each finished, for an area leaving
   * the page: nothing would ever finish them otherwise, and the server would
   * hold them on screen until they time out.
   */
  dispose(): void {
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
    // Each widget still on screen, with how it leaves.
    const shown = new Map<string, { target: TransitionTarget; transitionOut?: PlacementTransition }>();
    const leave = (widgetId: string): Promise<void> => {
      const child = shown.get(widgetId);
      if (!child) {
        return Promise.resolve();
      }
      shown.delete(widgetId);
      return this.animator.leave(child.target, child.transitionOut);
    };
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

      // One of the widget's own entrances is in its boot payload; a generic
      // one is played here once the frame has painted.
      const entrance =
        widget.transitionIn && isGenericTransitionType(widget.transitionIn.type) ? widget.transitionIn : undefined;
      let entering = entrance !== undefined;
      const enter = (): void => {
        if (!entering) {
          return;
        }
        entering = false;
        clearTimeout(entranceTimer);
        if (shown.has(widget.id)) {
          this.animator.enter({ element: iframe, frame: bridge }, entrance);
        }
      };
      const entranceTimer = entrance ? setTimeout(enter, ENTRANCE_WAIT_MS) : undefined;
      if (entrance) {
        this.animator.set(iframe, false);
      }
      let timed = false;

      const bridge: WidgetBridge = new WidgetBridge(instanceId, nonce, {
        onStorageGet: () => null,
        onStorageSubscribe: () => {},
        onStorageUnsubscribe: () => {},
        onStatusReport: (report) => this.opts.postStatus(instanceId, report),
        onEventsSubscribe: (subId, queue) => {
          timed = queue?.autoComplete === false;
          timeline.subscribed(widget.id, timed);
          bridge.sendEvent(subId, alertEvent);
        },
        onEventsUnsubscribe: () => {},
        onEventComplete: () => {
          timeline.completed(widget.id);
          // A widget with a length of its own is done: it leaves now. One
          // that completes at once stays up for the rest of the alert.
          if (timed) {
            void leave(widget.id);
          }
        },
        onDispose: () => {},
        onRendered: enter,
      });
      shown.set(widget.id, { target: { element: iframe, frame: bridge }, transitionOut: widget.transitionOut });
      iframe.addEventListener("load", createFrameLoadHandler(bridge));
      iframe.src =
        `${sceneBase}/alert/${encodeURIComponent(eventId)}/widget/${encodeURIComponent(widget.id)}` +
        `?nonce=${encodeURIComponent(nonce)}`;

      bridges.add(bridge);
      stage.appendChild(iframe);
      bridge.attach(iframe);
      children.push(bridge);
    }

    const tearDown = () => {
      clearInterval(timer);
      this.playing.delete(eventId);
      for (const bridge of children) {
        bridge.dispose();
        bridge.detach();
        bridges.delete(bridge);
      }
      stage.remove();
    };
    const timer = setInterval(() => {
      if (!timeline.isOver(Date.now())) {
        return;
      }
      clearInterval(timer);
      // Finished only once every widget has left, so the next alert never
      // starts under this one's exits.
      void Promise.all([...shown.keys()].map(leave)).then(() => {
        if (this.playing.get(eventId) === tearDown) {
          tearDown();
          this.opts.onFinished(eventId);
        }
      });
    }, TICK_MS);
    this.playing.set(eventId, tearDown);
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
