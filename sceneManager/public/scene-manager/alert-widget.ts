// Plays alerts inside an alert widget's area on the scene. An alert widget
// has no frame of its own: each alert is a composition, which the page plays
// with the scene runtime on a stage scaled from the alert's canvas to fit the
// area. The runtime places, stacks, shows and animates the alert's widgets
// as the alert's timeline says, each widget's frame reporting what the
// timeline is made of (it subscribed, painted, completed), and the alert is
// over once every widget has played out, exit animations included. The event
// queue holds the next alert until this one finishes, so an alert widget
// plays one alert at a time.

import { encodePlacementBoot, type WidgetBehaviorState, type WidgetEvent } from "@woofx3/module-sdk";
import {
  alertCompositionOf,
  type CompositionDocument,
  moduleIdOfCanonicalId,
  type NodeId,
  PROFILES,
} from "@woofx3/scene/model";
import {
  createDomRenderer,
  createScheduler,
  fitCanvas,
  type RenderDocument,
  type RenderElement,
  type Scheduler,
  type SchedulerClock,
} from "@woofx3/scene/runtime";
import type { AssetCache } from "./asset-loader";
import type { QueuedEvent } from "./event-queue";
import type { PageHost, PageLog } from "./page-host";
import { BehaviorRelay, entranceOf } from "./widget-behaviors";
import type { WidgetBridge, WidgetStatusReportPayload } from "./widget-bridge";
import { mountWidgetFrame } from "./widget-frame";

/** The slice of the server's `AlertDelivery` the page needs. */
export interface AlertDelivery {
  layout: CompositionDocument;
  event: { type: string; data: unknown } | null;
}

/** What one widget's frame reports: the facts the alert's timeline is made of. */
export interface AlertFrameFacts {
  /** The widget subscribed to its event; `timed` when it will call `complete()` itself. */
  subscribed(timed: boolean): void;
  rendered(): void;
  completed(): void;
}

/** One widget's frame in an alert, as the player drives it. */
export interface AlertFrame {
  sendBehavior(state: WidgetBehaviorState | null): void;
  unmount(): void;
}

export interface AlertPlayerOptions<TElement extends RenderElement<TElement>, THandle> {
  document: RenderDocument<TElement>;
  /** Where the alert's canvas goes. */
  stage: TElement;
  doc: CompositionDocument;
  clock: SchedulerClock<THandle>;
  /** Where a behavior the widget protocol cannot carry is reported; the console when absent. */
  log?: PageLog;
  /**
   * Put a widget's frame in its slot. `entrance` is the widget's own
   * entrance, to mark the frame with from boot (see `entranceOf`).
   */
  mountFrame(
    slot: TElement,
    widgetId: NodeId,
    entrance: WidgetBehaviorState | null,
    facts: AlertFrameFacts
  ): AlertFrame;
  /** Every widget has played out, exits included. Called once, after the player has stopped. */
  onFinished(): void;
}

export interface AlertPlayer {
  /** Take the alert off the stage now, without reporting it finished. Idempotent. */
  stop(): void;
}

/** Play one alert on `stage` until it finishes or is stopped. */
export function playAlert<TElement extends RenderElement<TElement>, THandle>(
  options: AlertPlayerOptions<TElement, THandle>
): AlertPlayer {
  const { doc } = options;
  const frames = new Map<NodeId, AlertFrame>();
  const subscribed = new Set<NodeId>();
  const relay = new BehaviorRelay((widgetId, state) => frames.get(widgetId)?.sendBehavior(state), options.log);
  let scheduler: Scheduler | null = null;
  let stopped = false;

  function record(fact: (playing: Scheduler) => void): void {
    if (stopped) {
      return;
    }
    if (scheduler === null) {
      throw new Error("alert: a frame reported before the alert started playing");
    }
    fact(scheduler);
  }

  const renderer = createDomRenderer({
    document: options.document,
    root: options.stage,
    mountContent: (slot, widgetId) => {
      // The engine dispatched only the widget kinds each widget declares
      // (see alert-layout.ts in the server), so every one left is played.
      const frame = options.mountFrame(
        slot,
        widgetId,
        entranceOf(doc, widgetId, () => true),
        {
          subscribed: (timed) => {
            subscribed.add(widgetId);
            record((playing) => playing.widgetSubscribed(widgetId, timed));
          },
          rendered: () => record((playing) => playing.widgetRendered(widgetId)),
          completed: () => {
            // Only a widget the alert is waiting on can finish; a completion
            // without a subscription is not one.
            if (subscribed.has(widgetId)) {
              record((playing) => playing.widgetCompleted(widgetId));
            }
          },
        }
      );
      frames.set(widgetId, frame);
      return () => {
        frames.delete(widgetId);
        relay.forget(widgetId);
        frame.unmount();
      };
    },
    onDelegate: (widgetId, request) => relay.handle(widgetId, request),
  });

  function stop(): void {
    if (stopped) {
      return;
    }
    stopped = true;
    scheduler?.dispose();
    renderer.dispose();
  }

  scheduler = createScheduler({
    doc,
    profile: PROFILES.alert,
    clock: options.clock,
    renderer,
    onFinished: () => {
      stop();
      options.onFinished();
    },
  });
  return { stop };
}

export interface AlertWidgetOptions {
  /** The alert widget's area on the scene. */
  element: HTMLElement;
  sceneBase: string;
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
}

export class AlertWidget {
  /** Tear-down for each alert on screen, by event id. */
  private readonly playing = new Map<string, () => void>();

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
      this.opts.host.log.warn("[scene-manager] malformed alert delivery; skipping", { eventId: item.eventId });
      this.opts.host.timers.setTimeout(() => this.opts.onFinished(item.eventId), 0);
      return true;
    }
    this.run(item.eventId, delivery);
    return true;
  }

  /**
   * Start reading the files an alert's widgets will ask for, as soon as the
   * alert is delivered rather than when its turn comes.
   */
  readAhead(value: unknown): void {
    const delivery = parseDelivery(value);
    if (delivery) {
      readAheadAlertAssets(this.opts.assets, delivery.layout);
    }
  }

  private run(eventId: string, delivery: AlertDelivery): void {
    const { element } = this.opts;
    const canvas = canvasOf(delivery.layout);

    const stage = this.opts.document.createElement("div");
    stage.className = "alert-stage";
    stage.style.width = `${canvas.width}px`;
    stage.style.height = `${canvas.height}px`;
    const fit = fitCanvas(canvas, { width: element.clientWidth, height: element.clientHeight });
    stage.style.transform = `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`;
    element.appendChild(stage);

    const alertEvent: WidgetEvent = {
      type: "alert",
      source: "scene-manager",
      time: new Date(this.opts.host.timers.now()).toISOString(),
      data: delivery.event,
      eventId,
    };

    readAheadAlertAssets(this.opts.assets, delivery.layout);
    let player: AlertPlayer | null = null;
    const tearDown = (): void => {
      this.playing.delete(eventId);
      player?.stop();
      stage.remove();
    };
    this.playing.set(eventId, tearDown);
    player = playAlert<HTMLElement, unknown>({
      document: this.opts.document,
      stage,
      doc: delivery.layout,
      clock: this.opts.clock,
      log: this.opts.host.log,
      mountFrame: (slot, widgetId, entrance, facts) =>
        this.mountFrame(eventId, alertEvent, delivery.layout, slot, widgetId, entrance, facts),
      onFinished: () => {
        tearDown();
        this.opts.onFinished(eventId);
      },
    });
  }

  private mountFrame(
    eventId: string,
    alertEvent: WidgetEvent,
    layout: CompositionDocument,
    slot: HTMLElement,
    widgetId: NodeId,
    entrance: WidgetBehaviorState | null,
    facts: AlertFrameFacts
  ): AlertFrame {
    const { sceneBase, bridges } = this.opts;
    const instanceId = `${eventId}.${widgetId}`;
    const placement = layout.widgets[widgetId];
    const moduleId = placement ? moduleIdOfCanonicalId(placement.widget) : null;
    const frame = mountWidgetFrame({
      slot,
      instanceId,
      bridges,
      document: this.opts.document,
      host: this.opts.host,
      // The frame document inlines the placement, so the fragment carries only
      // the entrance it is marked with from boot.
      src: (nonce) =>
        `${sceneBase}/alert/${encodeURIComponent(eventId)}/widget/${encodeURIComponent(widgetId)}` +
        `?nonce=${encodeURIComponent(nonce)}` +
        (entrance === null ? "" : `#${encodePlacementBoot({ behavior: entrance })}`),
      callbacks: ({ bridge }) => ({
        onStatusReport: (report) => this.opts.postStatus(instanceId, moduleId ?? "", report),
        onAssetLoad: this.opts.assets.loaderFor(moduleId),
        onEventsSubscribe: (subId, queue) => {
          facts.subscribed(queue?.autoComplete === false);
          bridge().sendEvent(subId, alertEvent);
        },
        onEventsUnsubscribe: () => {},
        onEventComplete: () => facts.completed(),
        onDispose: () => {},
        onRendered: () => facts.rendered(),
      }),
    });
    return {
      sendBehavior: (state) => frame.bridge.sendBehavior(state),
      unmount: () => frame.unmount(),
    };
  }
}

function readAheadAlertAssets(assets: AssetCache, layout: CompositionDocument): void {
  for (const placement of Object.values(layout.widgets)) {
    assets.warm(moduleIdOfCanonicalId(placement.widget), placement.settings);
  }
}

/** An alert's canvas size; `parseDelivery` has checked both are positive. */
function canvasOf(doc: CompositionDocument): { width: number; height: number } {
  return { width: doc.layout.width as number, height: doc.layout.height as number };
}

/**
 * The alert in a delivery, or null for one the page cannot play. A delivery
 * recorded before alerts were compositions holds the list shape, and is
 * converted.
 */
export function parseDelivery(value: unknown): AlertDelivery | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { layout, event } = value as { layout?: unknown; event?: AlertDelivery["event"] };
  const doc = alertCompositionOf(layout);
  if (doc === null || !isPositive(doc.layout.width) || !isPositive(doc.layout.height)) {
    return null;
  }
  return { layout: doc, event: event ?? null };
}

function isPositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
