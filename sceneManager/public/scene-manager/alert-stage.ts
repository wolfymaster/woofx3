// One alert on its stage: the scene runtime playing the alert's composition,
// scaled from its canvas to fit the alert widget's area. The runtime places,
// stacks, shows and animates the alert's widgets as the alert's timeline
// says, each widget's frame reporting what the timeline is made of (it
// subscribed, painted, completed), and the alert is over once every widget
// has played out, exit animations included.
//
// An alert is staged before it starts: its frames are mounted and boot while
// its time is held at 0 ms on a clock that can pause (preview-clock.ts), so
// a page can stage an alert ahead of time and start it the moment it is due.

import type { WidgetBehaviorState } from "@woofx3/module-sdk";
import { type CompositionDocument, type NodeId, PROFILES } from "@woofx3/scene/model";
import {
  createDomRenderer,
  createScheduler,
  type DelegateRequest,
  type RenderDocument,
  type RenderElement,
  type Scheduler,
  type SchedulerClock,
} from "@woofx3/scene/runtime";
import type { PageLog } from "@woofx3/widget-host/page";
import { createPreviewClock } from "./preview-clock";
import { BehaviorRelay, entranceOf } from "./widget-behaviors";

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

export interface AlertStageOptions<TElement extends RenderElement<TElement>, THandle> {
  document: RenderDocument<TElement>;
  /** Where the alert's canvas goes. */
  stage: TElement;
  doc: CompositionDocument;
  /** The clock the alert's time runs on once it starts; until then it holds at 0 ms. */
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
  /** Every widget has played out, exits included. Called once, after the stage has stopped. */
  onFinished(): void;
}

export interface StagedAlert {
  /**
   * Play from now: the alert's time and its animations run from 0 ms. What
   * its frames reported before is taken as reported at 0 ms, so frames that
   * loaded ahead of time enter at once. Called at most once.
   */
  start(): void;
  /** Take the alert off the stage now, without reporting it finished. Idempotent. */
  stop(): void;
}

/**
 * Put one alert on `stage`, held at its first moment: its frames are mounted
 * and load, subscribe and paint, but its time does not move and nothing
 * animates until `start`. An alert that plays at once is staged and started
 * together; one staged ahead of its alert lets the frames' loading happen
 * before anyone is waiting on it.
 */
export function stageAlert<TElement extends RenderElement<TElement>, THandle>(
  options: AlertStageOptions<TElement, THandle>
): StagedAlert {
  const { doc } = options;
  const frames = new Map<NodeId, AlertFrame>();
  const subscribed = new Set<NodeId>();
  const relay = new BehaviorRelay((widgetId, state) => frames.get(widgetId)?.sendBehavior(state), options.log);
  const clock = createPreviewClock(options.clock);
  // A widget plays a behavior handed to it from the moment it hears it, so
  // what the runtime hands over while the alert is held waits for `start`.
  const heldDelegations: Array<{ widgetId: NodeId; request: DelegateRequest }> = [];
  let scheduler: Scheduler | null = null;
  let started = false;
  let stopped = false;

  function record(fact: (playing: Scheduler) => void): void {
    if (stopped) {
      return;
    }
    if (scheduler === null) {
      throw new Error("alert: a frame reported before the alert was staged");
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
    onDelegate: (widgetId, request) => {
      if (started) {
        relay.handle(widgetId, request);
      } else {
        heldDelegations.push({ widgetId, request });
      }
    },
  });
  // Held at 0 ms with the clock, so no animation runs before `start`.
  renderer.pause();
  renderer.seek(0);

  function stop(): void {
    if (stopped) {
      return;
    }
    stopped = true;
    scheduler?.dispose();
    renderer.dispose();
    clock.dispose();
  }

  scheduler = createScheduler({
    doc,
    profile: PROFILES.alert,
    clock,
    renderer,
    onFinished: () => {
      stop();
      options.onFinished();
    },
  });

  return {
    start() {
      if (started) {
        throw new Error("alert: started twice");
      }
      if (stopped) {
        throw new Error("alert: started after it was stopped");
      }
      started = true;
      for (const { widgetId, request } of heldDelegations.splice(0)) {
        relay.handle(widgetId, request);
      }
      renderer.play();
      clock.play();
      scheduler?.resync();
    },
    stop,
  };
}
