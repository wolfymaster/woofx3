// An alert staged in an alert widget's area, hidden, with its widgets' frames
// booting, until it is given an alert to play. It is built from one delivery
// and can play any delivery of the same shape (`alertShape`): the same layout,
// behaviors and frames, whatever the settings. A workflow resolves its
// expressions into the settings before the alert is published, so the
// settings of two plays of one alert usually differ while nothing else does.
//
// Each frame is used for one alert only: a prepared alert plays once and is
// then torn down, so no widget carries state from one alert into the next.

import { encodePlacementBoot, type WidgetBehaviorState, type WidgetEvent } from "@woofx3/module-sdk";
import { type CompositionDocument, moduleIdOfCanonicalId, type NodeId } from "@woofx3/scene/model";
import { fitCanvas, type SchedulerClock } from "@woofx3/scene/runtime";
import {
  type AssetCache,
  mountWidgetFrame,
  type PageHost,
  settingsUpdate,
  type WidgetBridge,
  type WidgetStatusReportPayload,
} from "@woofx3/widget-host/page";
import type { AlertDelivery } from "../../contract/alert-delivery";
import { type AlertFrame, type AlertFrameFacts, type StagedAlert, stageAlert } from "./alert-stage";
import type { AlertFrameStage, AlertTimings } from "./alert-timing";

export interface PreparedAlertDeps {
  /** The alert widget's area, where the stage goes. */
  element: HTMLElement;
  document: Document;
  bridges: Set<WidgetBridge>;
  assets: AssetCache;
  clock: SchedulerClock<unknown>;
  host: PageHost;
  timings: AlertTimings;
  /** `moduleId` is the alert layout placement's, never the widget's claim. */
  postStatus(instanceId: string, moduleId: string, report: WidgetStatusReportPayload): void;
}

/** The alert a prepared alert is playing, once it is given one. */
interface Playing {
  eventId: string;
  event: WidgetEvent;
}

/** One widget's frame and what it has said before its alert was known. */
interface PreparedFrame {
  bridge: WidgetBridge;
  moduleId: string | null;
  settings: Record<string, unknown>;
  /** Subscriptions the widget opened before there was an alert to send them. */
  heldSubscriptions: string[];
  /** The latest status report for each key, held until the alert's id is known. */
  heldStatus: Map<string, WidgetStatusReportPayload>;
  /** Steps reached, in order, to be marked against the alert once it is known. */
  reached: AlertFrameStage[];
}

/**
 * What makes deliveries interchangeable for a prepared alert: everything but
 * the settings and the alert's own ids and event.
 */
export function alertShape(delivery: AlertDelivery): string {
  const widgets = Object.fromEntries(
    Object.entries(delivery.layout.widgets).map(([id, { settings: _settings, ...placement }]) => [id, placement])
  );
  return JSON.stringify({ layout: { ...delivery.layout, widgets }, frames: delivery.frames });
}

export class PreparedAlert {
  readonly shape: string;
  private readonly stage: HTMLElement;
  private readonly staged: StagedAlert;
  private readonly frames = new Map<NodeId, PreparedFrame>();
  private playing: Playing | null = null;
  private finished: (() => void) | null = null;

  constructor(
    private readonly deps: PreparedAlertDeps,
    private readonly delivery: AlertDelivery,
    /** Unique on the page: frames boot with `{id}.{widgetId}` as their instance id. */
    private readonly id: string
  ) {
    this.shape = alertShape(delivery);
    const canvas = canvasOf(delivery.layout);
    this.stage = deps.document.createElement("div");
    this.stage.className = "alert-stage";
    this.stage.style.width = `${canvas.width}px`;
    this.stage.style.height = `${canvas.height}px`;
    // Laid out like a playing alert, so its frames boot at their real size,
    // but not painted until it plays.
    this.stage.style.visibility = "hidden";
    deps.element.appendChild(this.stage);
    this.staged = stageAlert<HTMLElement, unknown>({
      document: deps.document,
      stage: this.stage,
      doc: delivery.layout,
      clock: deps.clock,
      log: deps.host.log,
      mountFrame: (slot, widgetId, entrance, facts) => this.mountFrame(slot, widgetId, entrance, facts),
      onFinished: () => {
        const finished = this.finished;
        this.stop();
        finished?.();
      },
    });
  }

  /**
   * Take on `next`'s settings, if this alert's frames can: each widget whose
   * settings differ gets them as a patch, which its bindings apply in place.
   * False, and nothing changed, when a widget would need a fresh frame for
   * them (it read a changed setting as it booted, or has not booted yet).
   */
  adopt(next: AlertDelivery): boolean {
    if (alertShape(next) !== this.shape || this.playing !== null) {
      return false;
    }
    const patches: Array<{ frame: PreparedFrame; settings: Record<string, unknown> }> = [];
    for (const [widgetId, frame] of this.frames) {
      const settings = next.layout.widgets[widgetId]?.settings;
      if (settings === undefined) {
        throw new Error(`alert: prepared widget ${widgetId} is missing from an alert of the same shape`);
      }
      const update = settingsUpdate(frame.settings, settings, frame.bridge.settingsReads());
      if (update === "reload") {
        return false;
      }
      if (update === "patch") {
        patches.push({ frame, settings });
      }
    }
    for (const { frame, settings } of patches) {
      frame.bridge.sendSettings(settings);
      frame.settings = settings;
    }
    return true;
  }

  /**
   * Play alert `eventId` (as delivered in `delivery`) from now: show the
   * stage, start its time, and hand the alert to every widget that has
   * subscribed. `onFinished` runs once every widget has played out.
   */
  start(eventId: string, delivery: AlertDelivery, onFinished: () => void): void {
    if (this.playing !== null) {
      throw new Error("alert: a prepared alert plays once");
    }
    const { element, timings, host } = this.deps;
    this.playing = {
      eventId,
      event: {
        type: "alert",
        source: "scene-manager",
        time: new Date(host.timers.now()).toISOString(),
        data: delivery.event,
        eventId,
      },
    };
    this.finished = onFinished;
    timings.alert(eventId, "started");
    for (const [widgetId, frame] of this.frames) {
      for (const stage of frame.reached) {
        timings.frame(eventId, widgetId, stage);
      }
      for (const report of frame.heldStatus.values()) {
        this.post(widgetId, frame, report);
      }
      frame.heldStatus.clear();
      for (const subId of frame.heldSubscriptions) {
        frame.bridge.sendEvent(subId, this.playing.event);
      }
      frame.heldSubscriptions = [];
    }
    const fit = fitCanvas(canvasOf(this.delivery.layout), { width: element.clientWidth, height: element.clientHeight });
    this.stage.style.transform = `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`;
    this.stage.style.visibility = "";
    this.staged.start();
  }

  /** Take the alert off the page now, without reporting it finished. Idempotent. */
  stop(): void {
    this.finished = null;
    this.staged.stop();
    this.stage.remove();
  }

  private mountFrame(
    slot: HTMLElement,
    widgetId: NodeId,
    entrance: WidgetBehaviorState | null,
    facts: AlertFrameFacts
  ): AlertFrame {
    const { bridges, document, host, assets } = this.deps;
    const placement = this.delivery.layout.widgets[widgetId];
    const framing = this.delivery.frames[widgetId];
    if (placement === undefined || framing === undefined) {
      throw new Error(`alert: widget ${widgetId} is not in its layout`);
    }
    const moduleId = moduleIdOfCanonicalId(placement.widget);
    const instanceId = `${this.id}.${widgetId}`;
    let prepared: PreparedFrame | null = null;
    const reach = (stage: AlertFrameStage): void => {
      prepared?.reached.push(stage);
      if (this.playing !== null) {
        this.deps.timings.frame(this.playing.eventId, widgetId, stage);
      }
    };
    const frame = mountWidgetFrame({
      slot,
      instanceId,
      bridges,
      document,
      host,
      // The widget's own document, the one its scene placements load and the
      // browser has cached; this alert's half of the boot rides in the fragment.
      src: (nonce) =>
        `${framing.frameUrl}#${encodePlacementBoot({
          nonce,
          instanceId,
          surface: "alert",
          settings: placement.settings,
          linkedResources: framing.linkedResources,
          ...(entrance === null ? {} : { behavior: entrance }),
        })}`,
      callbacks: ({ bridge }) => ({
        onStatusReport: (report) => {
          const held = this.frames.get(widgetId);
          if (held === undefined) {
            return;
          }
          if (this.playing === null) {
            held.heldStatus.set(report.key, report);
          } else {
            this.post(widgetId, held, report);
          }
        },
        onAssetLoad: assets.loaderFor(moduleId),
        onReady: () => reach("ready"),
        onEventsSubscribe: (subId, queue) => {
          reach("subscribed");
          facts.subscribed(queue?.autoComplete === false);
          if (this.playing === null) {
            this.frames.get(widgetId)?.heldSubscriptions.push(subId);
          } else {
            bridge().sendEvent(subId, this.playing.event);
          }
        },
        onEventsUnsubscribe: (subId) => {
          const held = this.frames.get(widgetId);
          if (held !== undefined) {
            held.heldSubscriptions = held.heldSubscriptions.filter((id) => id !== subId);
          }
        },
        onEventComplete: () => facts.completed(),
        onDispose: () => {},
        onRendered: () => {
          reach("rendered");
          facts.rendered();
        },
      }),
    });
    prepared = {
      bridge: frame.bridge,
      moduleId,
      settings: placement.settings,
      heldSubscriptions: [],
      heldStatus: new Map(),
      reached: [],
    };
    this.frames.set(widgetId, prepared);
    reach("mounted");
    return {
      sendBehavior: (state) => frame.bridge.sendBehavior(state),
      unmount: () => {
        this.frames.delete(widgetId);
        frame.unmount();
      },
    };
  }

  /** Report a widget's status under the alert's instance id, `{eventId}.{widgetId}`. */
  private post(widgetId: NodeId, frame: PreparedFrame, report: WidgetStatusReportPayload): void {
    if (this.playing === null) {
      throw new Error("alert: a status was posted before the alert was known");
    }
    const instanceId = `${this.playing.eventId}.${widgetId}`;
    this.deps.postStatus(instanceId, frame.moduleId ?? "", { ...report, instanceId });
  }
}

/** An alert's canvas size; `parseAlertDelivery` has checked both are positive. */
function canvasOf(doc: CompositionDocument): { width: number; height: number } {
  return { width: doc.layout.width as number, height: doc.layout.height as number };
}
