// Plays a composition the editor posts, on a clock the editor controls.
//
// The dashboard's alert editor embeds `/preview/composition` and drives it
// with the messages in @woofx3/scene's runtime/preview-protocol.ts. This is
// the page's logic, with the DOM, the clock and the frames injected so tests
// can drive it; composition-preview-page.ts wires it to the window.
//
// A load binds the composition's inputs, asks the engine how to frame its
// widgets, and plays it with the same runtime and widget frames an overlay
// uses (createDomRenderer, createScheduler, the widget bridge), held at 0 ms
// until `play`. Frames are mounted at once, so they load and paint while the
// editor is still deciding, and receive the sample event when the playhead
// first runs.
//
// Seeking. The scheduler resolves with estimates (a widget's length from its
// `settings.duration`, or a media widget's from its media's length; see
// `mediaLengthEstimates`, which the editor's tracks use too), so every time on the timeline is known before
// anything plays, and runs on a clock that pauses and jumps (preview-clock.ts).
// Host behaviors are Web Animations sharing one origin, so a seek is exact:
// boxes, transitions, effects and activity windows show what they show at
// that moment. What a widget plays itself cannot be seeked: its own content
// (a video, a sound, text it typed in on the event) runs in its frame on its
// own time, and the widget protocol has no offset for a delegated behavior.
// After a seek, each behavior the widget is playing at the new time is sent
// again: one still running with the time it has left, so it ends when the
// composition says although it starts over; one already over with no time at
// all, so the widget lands on its end state. A pause stops the host's
// animations only.
//
// Measuring. The timeline starts from estimates; what frames report replaces
// them (a video's real length, a frame that is slow to paint) only while the
// run is uninterrupted from the start, as on an overlay. After the first
// pause or seek the clock no longer runs in step with the frames' own time,
// so their reports are ignored and the timeline holds still under the
// playhead. `restart` starts a fresh, measured run with fresh frames.

import type { WidgetBehaviorState } from "@woofx3/module-sdk";
import {
  bindInputs,
  type CompositionDocument,
  type DeclaredBehaviorKinds,
  declaresKind,
  mediaLengthEstimates,
  type NodeId,
  PROFILES,
  type ProfileId,
} from "@woofx3/scene/model";
import {
  COMPOSITION_PREVIEW_PROTOCOL,
  createDomRenderer,
  createScheduler,
  type DelegatedBehavior,
  type DomRenderer,
  type DroppedEntry,
  PREVIEW_FINISHED,
  PREVIEW_LOAD,
  PREVIEW_OVERRIDES,
  PREVIEW_PAUSE,
  PREVIEW_PLAY,
  PREVIEW_PLAYHEAD,
  PREVIEW_PROBLEMS,
  PREVIEW_READY,
  PREVIEW_RESTART,
  PREVIEW_SEEK,
  PREVIEW_TIMELINE,
  type PreviewLoadMessage,
  type PreviewProblem,
  type PreviewReport,
  type PreviewSampleEvent,
  parsePreviewCommand,
  type RenderDocument,
  type RenderElement,
  type Scheduler,
  type SchedulerClock,
  type TransientOverrides,
} from "@woofx3/scene/runtime";
import { createPreviewClock, type PreviewClock } from "./preview-clock";
import { BehaviorRelay, behaviorStateOf, entranceOf } from "./widget-behaviors";

/** How often the playhead is reported while playing. */
export const PLAYHEAD_REPORT_MS = 100;

/** How the engine frames one widget (see `POST /preview/composition/frames`). */
export interface PreviewFrameMeta {
  frameUrl: string;
  linkedResources: Record<string, string>;
  /** Upstream URL to the media proxy URL signed for it, for this widget's settings. */
  mediaUrls: Record<string, string>;
  /** The kinds the widget declares it plays itself; any other widget kind is skipped, as on an overlay. */
  behaviorKinds: DeclaredBehaviorKinds;
}

/** The engine's answer for a document's widgets: those it can frame, and why the rest cannot be. */
export interface FrameResolution {
  widgets: Record<NodeId, PreviewFrameMeta>;
  problems: PreviewProblem[];
}

/** What a frame is mounted with. */
export interface PreviewFrameSpec {
  widgetId: NodeId;
  meta: PreviewFrameMeta;
  settings: Record<string, unknown>;
  surface: ProfileId;
  /** The widget's own entrance, to mark the frame with from boot (see `entranceOf`). */
  entrance: WidgetBehaviorState | null;
  event: PreviewSampleEvent | null;
}

/** What a frame reports, which the timeline is made of. */
export interface PreviewFrameFacts {
  subscribed(timed: boolean): void;
  rendered(): void;
  completed(): void;
}

export interface PreviewFrame {
  sendBehavior(state: WidgetBehaviorState | null): void;
  /** The playhead has run: hand the sample event to the widget, now or once it subscribes. */
  release(): void;
  unmount(): void;
}

export interface CompositionPreviewOptions<TElement extends RenderElement<TElement>, THandle> {
  document: RenderDocument<TElement>;
  /** Where the composition's canvas goes. */
  stage: TElement;
  /** Size and fit the stage for a canvas. */
  fitStage(canvas: { width: number; height: number }): void;
  /** The page clock; the preview clock runs on it. */
  baseClock: SchedulerClock<THandle>;
  resolveFrames(doc: CompositionDocument): Promise<FrameResolution>;
  mountFrame(slot: TElement, spec: PreviewFrameSpec, facts: PreviewFrameFacts): PreviewFrame;
  post(report: PreviewReport): void;
}

export interface CompositionPreview {
  /** A message posted by the embedding page; anything not of the protocol is ignored. */
  handle(data: unknown): void;
  dispose(): void;
}

/** A composition loaded and bound, ready to play. */
interface Loaded {
  loadId: string;
  profile: ProfileId;
  doc: CompositionDocument;
  event: PreviewSampleEvent | null;
  frames: Record<NodeId, PreviewFrameMeta>;
  /** Problems known at load: dropped entries, bind, framing. */
  problems: PreviewProblem[];
}

/** One run of a loaded composition, from its start. */
interface Playback {
  clock: PreviewClock;
  renderer: DomRenderer<unknown>;
  scheduler: Scheduler;
  frames: Map<NodeId, PreviewFrame>;
  /** The playhead has run at least once. */
  started: boolean;
  /** Frames' reports still go into the timeline (see the header). */
  measuring: boolean;
  finished: boolean;
}

export function createCompositionPreview<TElement extends RenderElement<TElement>, THandle>(
  options: CompositionPreviewOptions<TElement, THandle>
): CompositionPreview {
  let loaded: Loaded | null = null;
  let playback: Playback | null = null;
  let transient: TransientOverrides | undefined;
  // Bumped by every load, so a framing answer for a superseded one is dropped.
  let generation = 0;
  let ticker: { handle: THandle } | null = null;
  let lastTimeline = "";
  let lastProblems = "";
  let disposed = false;

  options.post({ type: PREVIEW_READY, protocol: COMPOSITION_PREVIEW_PROTOCOL });

  function handle(data: unknown): void {
    if (disposed) {
      return;
    }
    const parsed = parsePreviewCommand(data);
    if (parsed === null) {
      return;
    }
    if (!parsed.ok) {
      postProblems(null, [{ kind: "invalid-message", detail: parsed.error }]);
      return;
    }
    const { command } = parsed;
    switch (command.type) {
      case PREVIEW_LOAD:
        void load(command, parsed.dropped);
        break;
      case PREVIEW_OVERRIDES:
        transient = command.overrides ?? undefined;
        playback?.scheduler.setTransient(transient);
        break;
      case PREVIEW_PLAY:
        play();
        break;
      case PREVIEW_PAUSE:
        pause();
        break;
      case PREVIEW_SEEK:
        seek(command.ms);
        break;
      case PREVIEW_RESTART:
        restart();
        break;
      default:
        throw new Error(`composition preview: unhandled command ${JSON.stringify(command)}`);
    }
  }

  async function load(command: PreviewLoadMessage, dropped: DroppedEntry[]): Promise<void> {
    generation += 1;
    const current = generation;
    stopPlayback();
    loaded = null;
    transient = undefined;
    lastTimeline = "";

    const problems: PreviewProblem[] = dropped.map(({ id, reason }) => ({ kind: "invalid-entry", id, detail: reason }));
    const bound = bindInputs(command.document, command.inputs ?? {});
    if (!bound.ok) {
      postProblems(command.loadId, [...problems, ...bindProblems(bound.report)]);
      return;
    }

    let resolution: FrameResolution;
    try {
      resolution = await options.resolveFrames(bound.document);
    } catch (err) {
      resolution = {
        widgets: {},
        problems: [{ kind: "frames-unavailable", detail: err instanceof Error ? err.message : String(err) }],
      };
    }
    if (current !== generation || disposed) {
      return;
    }
    loaded = {
      loadId: command.loadId,
      profile: command.profile,
      doc: bound.document,
      event: command.event ?? null,
      frames: resolution.widgets,
      problems: [...problems, ...resolution.problems],
    };
    startPlayback(command.autoplay === true);
  }

  function startPlayback(autoplay: boolean): void {
    const current = mustBeLoaded();
    const { doc, profile } = current;
    options.fitStage({ width: doc.layout.width as number, height: doc.layout.height as number });

    const clock = createPreviewClock(options.baseClock);
    const frames = new Map<NodeId, PreviewFrame>();
    const relay = new BehaviorRelay((widgetId, state) => frames.get(widgetId)?.sendBehavior(state));
    // Assigned below; frames mounted by the scheduler's first plan only
    // report once their documents load, after it exists.
    let run: Playback | null = null;

    const fact = (report: (scheduler: Scheduler) => void): void => {
      if (run === null || playback !== run || !run.measuring) {
        return;
      }
      report(run.scheduler);
      reportTimeline();
    };

    const renderer = createDomRenderer({
      document: options.document,
      root: options.stage,
      atMs: 0,
      mountContent: (slot, widgetId) => {
        const meta = current.frames[widgetId];
        if (meta === undefined) {
          throw new Error(`composition preview: widget ${widgetId} was planned without a frame`);
        }
        const subscribed = new Set<NodeId>();
        const frame = options.mountFrame(
          slot,
          {
            widgetId,
            meta,
            settings: doc.widgets[widgetId].settings,
            surface: PROFILES[profile].surface,
            entrance: entranceOf(doc, widgetId, (type, kind) => declaresKind(meta.behaviorKinds, type, kind)),
            event: current.event,
          },
          {
            subscribed: (timed) => {
              subscribed.add(widgetId);
              fact((scheduler) => scheduler.widgetSubscribed(widgetId, timed));
            },
            rendered: () => fact((scheduler) => scheduler.widgetRendered(widgetId)),
            completed: () => {
              if (subscribed.has(widgetId)) {
                fact((scheduler) => scheduler.widgetCompleted(widgetId));
              }
            },
          }
        );
        frames.set(widgetId, frame);
        if (run?.started) {
          frame.release();
        }
        return () => {
          frames.delete(widgetId);
          relay.forget(widgetId);
          frame.unmount();
        };
      },
      onDelegate: (widgetId, request) => relay.handle(widgetId, request),
    });
    // Held at the start until the editor plays it.
    renderer.pause();
    renderer.seek(0);

    const scheduler = createScheduler({
      doc,
      profile: PROFILES[profile],
      clock,
      renderer,
      meta: current.frames,
      declaredKinds: (widgetId) => current.frames[widgetId]?.behaviorKinds,
      estimate: { durationsMs: mediaLengthEstimates(doc) },
      onFinished: () => finish(),
    });
    run = {
      clock,
      renderer: renderer as DomRenderer<unknown>,
      scheduler,
      frames,
      started: false,
      measuring: true,
      finished: false,
    };
    playback = run;
    if (transient !== undefined) {
      scheduler.setTransient(transient);
    }
    reportTimeline();
    reportPlayhead();
    if (autoplay) {
      play();
    }
  }

  function stopPlayback(): void {
    stopTicker();
    if (playback === null) {
      return;
    }
    const stopping = playback;
    playback = null;
    stopping.scheduler.dispose();
    stopping.renderer.dispose();
    stopping.clock.dispose();
  }

  function play(): void {
    const run = playback;
    if (run === null || run.clock.playing()) {
      return;
    }
    const durationMs = run.scheduler.timeline().finishMs;
    if (run.finished && durationMs !== null && run.clock.now() >= durationMs) {
      // Play at the end starts over, as a media player does.
      seek(0);
    }
    run.clock.play();
    run.renderer.play();
    if (!run.started) {
      run.started = true;
      for (const frame of run.frames.values()) {
        frame.release();
      }
    }
    startTicker();
    reportPlayhead();
  }

  function pause(): void {
    const run = playback;
    if (run === null || !run.clock.playing()) {
      return;
    }
    holdAtPlayhead(run);
    reportPlayhead();
  }

  function holdAtPlayhead(run: Playback): void {
    run.clock.pause();
    run.renderer.pause();
    // Keep both on one reading: the renderer paused at its own reading of the
    // document timeline, a moment after the clock.
    run.renderer.seek(run.clock.now());
    if (run.started) {
      run.measuring = false;
    }
    stopTicker();
  }

  function seek(ms: number): void {
    const run = playback;
    if (run === null) {
      return;
    }
    run.measuring = false;
    run.clock.seek(ms);
    run.renderer.seek(ms);
    run.scheduler.resync();
    if (playback !== run) {
      return;
    }
    if (run.scheduler.timeline().finishMs === null || ms < (run.scheduler.timeline().finishMs as number)) {
      run.finished = false;
    }
    replayDelegations(run, ms);
    reportTimeline();
    reportPlayhead();
  }

  function restart(): void {
    if (loaded === null) {
      return;
    }
    stopPlayback();
    startPlayback(true);
  }

  function finish(): void {
    const run = playback;
    if (run === null) {
      return;
    }
    run.finished = true;
    if (run.clock.playing()) {
      holdAtPlayhead(run);
    }
    const current = mustBeLoaded();
    options.post({ type: PREVIEW_FINISHED, loadId: current.loadId, ms: run.clock.now() });
    reportPlayhead();
  }

  /** After a seek: tell each widget again what it plays at `ms` (see the header). */
  function replayDelegations(run: Playback, ms: number): void {
    for (const [widgetId, widget] of Object.entries(run.scheduler.plan().widgets)) {
      const frame = run.frames.get(widgetId);
      if (frame === undefined || widget.delegated.length === 0) {
        continue;
      }
      frame.sendBehavior(null);
      for (const type of ["transition", "effect"]) {
        const latest = widget.delegated
          .filter((delegated) => delegated.type === type)
          .sort((a, b) => b.startMs - a.startMs)[0];
        const state = latest === undefined ? null : stateFrom(latest, ms);
        if (state !== null) {
          frame.sendBehavior(state);
        }
      }
    }
  }

  function startTicker(): void {
    stopTicker();
    const tick = (): void => {
      ticker = null;
      if (playback === null || !playback.clock.playing()) {
        return;
      }
      reportPlayhead();
      ticker = { handle: options.baseClock.setTimer(options.baseClock.now() + PLAYHEAD_REPORT_MS, tick) };
    };
    ticker = { handle: options.baseClock.setTimer(options.baseClock.now() + PLAYHEAD_REPORT_MS, tick) };
  }

  function stopTicker(): void {
    if (ticker !== null) {
      options.baseClock.clearTimer(ticker.handle);
      ticker = null;
    }
  }

  function reportPlayhead(): void {
    if (playback === null || loaded === null) {
      return;
    }
    options.post({
      type: PREVIEW_PLAYHEAD,
      loadId: loaded.loadId,
      ms: playback.clock.now(),
      playing: playback.clock.playing(),
    });
  }

  /** The timeline and problems, each posted when it differs from the last one posted. */
  function reportTimeline(): void {
    if (playback === null || loaded === null) {
      return;
    }
    const timeline = playback.scheduler.timeline();
    const serialized = JSON.stringify(timeline);
    if (serialized !== lastTimeline) {
      lastTimeline = serialized;
      options.post({
        type: PREVIEW_TIMELINE,
        loadId: loaded.loadId,
        timeline,
        durationMs: PROFILES[loaded.profile].bounded ? timeline.finishMs : null,
      });
    }
    postProblems(loaded.loadId, [
      ...loaded.problems,
      ...timeline.problems.map(
        ({ behavior, kind }): PreviewProblem => ({ kind: "timeline", id: behavior, detail: kind })
      ),
      ...playback.scheduler
        .plan()
        .skipped.map(({ behavior, reason }): PreviewProblem => ({ kind: "plan", id: behavior, detail: reason })),
    ]);
  }

  function postProblems(loadId: string | null, problems: PreviewProblem[]): void {
    const serialized = JSON.stringify([loadId, problems]);
    if (serialized === lastProblems) {
      return;
    }
    lastProblems = serialized;
    options.post({ type: PREVIEW_PROBLEMS, loadId, problems });
  }

  function mustBeLoaded(): Loaded {
    if (loaded === null) {
      throw new Error("composition preview: nothing is loaded");
    }
    return loaded;
  }

  return {
    handle,
    dispose() {
      disposed = true;
      generation += 1;
      stopPlayback();
    },
  };
}

/**
 * A delegated behavior as the widget is told it at `ms`: one still running
 * with the time it has left, one already over with none.
 */
function stateFrom(delegated: DelegatedBehavior, ms: number): WidgetBehaviorState | null {
  const state = behaviorStateOf(delegated);
  if (state === null || delegated.endMs === null) {
    return state;
  }
  return { ...state, durationMs: Math.max(0, delegated.endMs - ms) };
}

function bindProblems(report: {
  missing: string[];
  unknownReferences: Array<{ input: string }>;
  malformed: Array<Array<string | number>>;
}): PreviewProblem[] {
  return [
    ...report.missing.map((input): PreviewProblem => ({ kind: "bind", id: input, detail: "missing input" })),
    ...report.unknownReferences.map(
      ({ input }): PreviewProblem => ({ kind: "bind", id: input, detail: "refers to an input it does not declare" })
    ),
    ...report.malformed.map(
      (path): PreviewProblem => ({ kind: "bind", detail: `malformed input reference at ${path.join(".")}` })
    ),
  ];
}
