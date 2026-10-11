import { describe, expect, test } from "bun:test";
import {
  type BehaviorDocument,
  type CompositionDocument,
  MAX_ALERT_MS,
  MEDIA_LENGTH_HINT_SETTING,
  mediaLengthEstimates,
  type PlacementDocument,
  PROFILES,
  RENDER_WAIT_MS,
  resolveTimeline,
  SUBSCRIBE_TIMEOUT_MS,
  type TimelineFacts,
  type Timing,
  UNTIMED_ALERT_MS,
  type WidgetFacts,
} from "../model";

const T0 = 1_000_000;

function placement(overrides: Partial<PlacementDocument> = {}): PlacementDocument {
  return {
    widget: "woofx3:widget:text",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    visible: true,
    z: "a0",
    settings: {},
    name: "Widget",
    rotation: 0,
    opacity: 1,
    locked: false,
    extra: {},
    ...overrides,
  };
}

function timing(overrides: Partial<Timing> = {}): Timing {
  return { anchor: "enter", offsetMs: 0, durationMs: 500, easing: "ease-out", ...overrides };
}

function behavior(
  type: string,
  target: string,
  timingOverrides: Partial<Timing> = {},
  params: Record<string, unknown> = {},
  order = "a0"
): BehaviorDocument {
  return { type, kind: "fade", target, order, timing: timing(timingOverrides), params };
}

function compose(
  widgets: Record<string, Partial<PlacementDocument>>,
  behaviors: Record<string, BehaviorDocument> = {}
): CompositionDocument {
  const placed: Record<string, PlacementDocument> = {};
  for (const [id, overrides] of Object.entries(widgets)) {
    placed[id] = placement(overrides);
  }
  return { layout: { width: 1920, height: 1080 }, widgets: placed, behaviors };
}

/** Facts on a clock that does not start at zero, so relative times are checked. */
function facts(nowMs: number | undefined, widgets: Record<string, WidgetFacts> = {}): TimelineFacts {
  const shifted: Record<string, WidgetFacts> = {};
  for (const [id, widget] of Object.entries(widgets)) {
    shifted[id] = {
      ...widget,
      subscribedAtMs: widget.subscribedAtMs === undefined ? undefined : widget.subscribedAtMs + T0,
      renderedAtMs: widget.renderedAtMs === undefined ? undefined : widget.renderedAtMs + T0,
      completedAtMs: widget.completedAtMs === undefined ? undefined : widget.completedAtMs + T0,
      visibility: widget.visibility?.map((change) => ({ ...change, atMs: change.atMs + T0 })),
    };
  }
  return { startedAtMs: T0, nowMs: nowMs === undefined ? undefined : nowMs + T0, widgets: shifted };
}

const alert = PROFILES.alert;
const scene = PROFILES.scene;

describe("alert end", () => {
  test("ends when every timed widget has completed", () => {
    const doc = compose({ video: {}, text: {} });
    const result = resolveTimeline(
      doc,
      alert,
      facts(9_000, {
        video: { subscribedAtMs: 100, timed: true, renderedAtMs: 50, completedAtMs: 8_000 },
        text: { subscribedAtMs: 200, timed: false, renderedAtMs: 60 },
      })
    );
    expect(result.endMs).toBe(8_000);
    expect(result.finishMs).toBe(8_000);
    expect(result.widgets.video).toEqual({
      status: "timed",
      enterMs: 50,
      completeMs: 8_000,
      leaveMs: 8_000,
      exitMs: 8_000,
    });
    expect(result.widgets.text.status).toBe("untimed");
    expect(result.widgets.text.completeMs).toBe(200);
    expect(result.widgets.text.leaveMs).toBe(8_000);
  });

  test("is not known while a timed widget is still playing", () => {
    const doc = compose({ video: {} });
    const result = resolveTimeline(doc, alert, facts(3_000, { video: { subscribedAtMs: 100, timed: true } }));
    expect(result.endMs).toBeNull();
    expect(result.finishMs).toBeNull();
    expect(result.widgets.video.leaveMs).toBeNull();
    expect(result.revisitAtMs).toBe(MAX_ALERT_MS);
  });

  test("an alert with no timed widget holds for the untimed hold", () => {
    const doc = compose({ text: {}, image: {} });
    const result = resolveTimeline(
      doc,
      alert,
      facts(300, { text: { subscribedAtMs: 100, timed: false }, image: { subscribedAtMs: 250, timed: false } })
    );
    expect(result.endMs).toBe(UNTIMED_ALERT_MS);
    expect(result.widgets.text.exitMs).toBe(UNTIMED_ALERT_MS);
  });

  test("a timed widget that completes early waives the untimed hold", () => {
    const doc = compose({ sound: {}, text: {} });
    const result = resolveTimeline(
      doc,
      alert,
      facts(1_500, {
        sound: { subscribedAtMs: 100, timed: true, completedAtMs: 1_200 },
        text: { subscribedAtMs: 100, timed: false },
      })
    );
    expect(result.endMs).toBe(1_200);
  });

  test("waits for a widget that has not subscribed yet", () => {
    const doc = compose({ text: {}, slow: {} });
    const result = resolveTimeline(doc, alert, facts(6_000, { text: { subscribedAtMs: 100, timed: false } }));
    expect(result.widgets.slow.status).toBe("pending");
    expect(result.endMs).toBeNull();
    expect(result.revisitAtMs).toBe(SUBSCRIBE_TIMEOUT_MS);
  });

  test("ignores a widget that did not subscribe within the timeout", () => {
    const doc = compose({ text: {}, broken: {} });
    const result = resolveTimeline(
      doc,
      alert,
      facts(SUBSCRIBE_TIMEOUT_MS, { text: { subscribedAtMs: 100, timed: false } })
    );
    expect(result.widgets.broken.status).toBe("ignored");
    expect(result.widgets.broken.completeMs).toBeNull();
    // The alert waited for it until the timeout, then ended.
    expect(result.endMs).toBe(SUBSCRIBE_TIMEOUT_MS);
    expect(result.widgets.broken.exitMs).toBe(SUBSCRIBE_TIMEOUT_MS);
  });

  test("a subscription after the timeout is still ignored", () => {
    const doc = compose({ late: {} });
    const result = resolveTimeline(
      doc,
      alert,
      facts(SUBSCRIBE_TIMEOUT_MS + 500, { late: { subscribedAtMs: SUBSCRIBE_TIMEOUT_MS + 1, timed: true } })
    );
    expect(result.widgets.late.status).toBe("ignored");
    expect(result.endMs).toBe(SUBSCRIBE_TIMEOUT_MS);
  });

  test("the cap ends an alert whose timed widget never completes", () => {
    const doc = compose({ video: {}, text: {} });
    const playing = { video: { subscribedAtMs: 100, timed: true }, text: { subscribedAtMs: 100, timed: false } };
    expect(resolveTimeline(doc, alert, facts(MAX_ALERT_MS - 1, playing)).endMs).toBeNull();
    const capped = resolveTimeline(doc, alert, facts(MAX_ALERT_MS, playing));
    expect(capped.endMs).toBe(MAX_ALERT_MS);
    expect(capped.widgets.video.leaveMs).toBe(MAX_ALERT_MS);
    expect(capped.widgets.video.completeMs).toBeNull();
    expect(capped.finishMs).toBe(MAX_ALERT_MS);
  });

  test("an alert with no widgets holds for the untimed hold", () => {
    const result = resolveTimeline(compose({}), alert, facts(0));
    expect(result.endMs).toBe(UNTIMED_ALERT_MS);
    expect(result.finishMs).toBe(UNTIMED_ALERT_MS);
  });

  test("a hidden widget does not play: nothing waits for it and nothing anchored to it happens", () => {
    const doc = compose(
      { video: {}, sound: { visible: false }, thanks: {} },
      {
        fade: behavior("transition", "sound", { anchor: "enter" }, { phase: "in" }),
        window: behavior("activity", "thanks", { anchor: "complete", node: "sound", offsetMs: 0, durationMs: 1_000 }),
      }
    );
    const result = resolveTimeline(
      doc,
      alert,
      facts(2_500, { video: { subscribedAtMs: 100, timed: true, renderedAtMs: 50, completedAtMs: 2_000 } })
    );
    expect(result.widgets.sound).toEqual({
      status: "never",
      enterMs: null,
      completeMs: null,
      leaveMs: null,
      exitMs: null,
    });
    expect(result.widgets.thanks.status).toBe("never");
    expect(result.behaviors.fade).toEqual({ startMs: null, endMs: null });
    expect(result.endMs).toBe(2_000);
    expect(result.finishMs).toBe(2_000);
    expect(result.revisitAtMs).toBeNull();
  });

  test("without a now, nothing missing is final", () => {
    const doc = compose({ text: {} });
    const result = resolveTimeline(doc, alert, facts(undefined));
    expect(result.widgets.text.status).toBe("pending");
    expect(result.endMs).toBeNull();
    expect(result.revisitAtMs).toBeNull();
  });
});

describe("rendering", () => {
  test("a widget is shown once it paints, but not later than the render wait", () => {
    const doc = compose({ painted: {}, slow: {}, waiting: {} });
    const result = resolveTimeline(
      doc,
      alert,
      facts(RENDER_WAIT_MS + 100, { painted: { renderedAtMs: 300 }, slow: { renderedAtMs: RENDER_WAIT_MS + 50 } })
    );
    expect(result.widgets.painted.enterMs).toBe(300);
    expect(result.widgets.slow.enterMs).toBe(RENDER_WAIT_MS);
    expect(result.widgets.waiting.enterMs).toBe(RENDER_WAIT_MS);
  });

  test("an unpainted widget is not shown before the render wait passes", () => {
    const doc = compose({ waiting: {} });
    const result = resolveTimeline(doc, alert, facts(100));
    expect(result.widgets.waiting.enterMs).toBeNull();
    expect(result.revisitAtMs).toBe(RENDER_WAIT_MS);
  });
});

describe("transitions and exits", () => {
  const settled = {
    video: { subscribedAtMs: 0, timed: true, renderedAtMs: 0, completedAtMs: 4_000 },
    text: { subscribedAtMs: 0, timed: false, renderedAtMs: 0 },
  };

  test("an in transition starts at its target's enter, plus its offset", () => {
    const doc = compose(
      { video: {}, text: {} },
      { in: behavior("transition", "text", { anchor: "enter", offsetMs: 200, durationMs: 300 }, { phase: "in" }) }
    );
    const result = resolveTimeline(doc, alert, facts(5_000, settled));
    expect(result.behaviors.in).toEqual({ startMs: 200, endMs: 500 });
  });

  test("an out transition ends at its target's exit, which waits for it", () => {
    const doc = compose(
      { video: {}, text: {} },
      {
        videoOut: behavior("transition", "video", { anchor: "exit", durationMs: 600 }, { phase: "out" }),
        textOut: behavior("transition", "text", { anchor: "exit", durationMs: 400 }, { phase: "out" }),
      }
    );
    const result = resolveTimeline(doc, alert, facts(5_000, settled));
    // The timed widget starts leaving as it completes and is hidden after its exit animation.
    expect(result.widgets.video.leaveMs).toBe(4_000);
    expect(result.widgets.video.exitMs).toBe(4_600);
    expect(result.behaviors.videoOut).toEqual({ startMs: 4_000, endMs: 4_600 });
    // The untimed one leaves at the end.
    expect(result.endMs).toBe(4_000);
    expect(result.behaviors.textOut).toEqual({ startMs: 4_000, endMs: 4_400 });
    // The alert finishes only once every exit animation has ended.
    expect(result.finishMs).toBe(4_600);
  });

  test("an out transition with a negative offset ends before the exit and holds its last frame", () => {
    const doc = compose(
      { video: {}, text: {} },
      { out: behavior("transition", "video", { anchor: "exit", offsetMs: -100, durationMs: 500 }, { phase: "out" }) }
    );
    const result = resolveTimeline(doc, alert, facts(5_000, settled));
    expect(result.widgets.video.exitMs).toBe(4_600);
    expect(result.behaviors.out).toEqual({ startMs: 4_000, endMs: 4_500 });
  });

  test("an effect anchored before the exit delays the exit so it can run", () => {
    const doc = compose(
      { video: {}, text: {} },
      { shake: behavior("effect", "text", { anchor: "exit", offsetMs: -1_000, durationMs: "until-exit" }) }
    );
    const result = resolveTimeline(doc, alert, facts(5_000, settled));
    expect(result.widgets.text.leaveMs).toBe(4_000);
    expect(result.widgets.text.exitMs).toBe(5_000);
    expect(result.behaviors.shake).toEqual({ startMs: 4_000, endMs: 5_000 });
    expect(result.finishMs).toBe(5_000);
  });

  test("until-exit runs from the anchor to the target's exit", () => {
    const doc = compose(
      { video: {}, text: {} },
      {
        pulse: behavior("effect", "video", { anchor: "enter", offsetMs: 1_000, durationMs: "until-exit" }),
        canvasGlow: behavior("effect", "canvas", { anchor: "start", offsetMs: 0, durationMs: "until-exit" }),
      }
    );
    const result = resolveTimeline(doc, alert, facts(5_000, settled));
    expect(result.behaviors.pulse).toEqual({ startMs: 1_000, endMs: 4_000 });
    expect(result.behaviors.canvasGlow).toEqual({ startMs: 0, endMs: 4_000 });
  });

  test("behaviors anchored to the end, the start and a completion", () => {
    const doc = compose(
      { video: {}, text: {} },
      {
        atEnd: behavior("effect", "text", { anchor: "end", offsetMs: -500, durationMs: 500 }),
        atStart: behavior("effect", "text", { anchor: "start", offsetMs: 250, durationMs: 100 }),
        onDone: behavior("effect", "text", { anchor: "complete", node: "video", offsetMs: 0, durationMs: 100 }),
        ownDone: behavior("effect", "video", { anchor: "complete", offsetMs: 10, durationMs: 100 }),
      }
    );
    const result = resolveTimeline(doc, alert, facts(5_000, settled));
    expect(result.behaviors.atEnd).toEqual({ startMs: 3_500, endMs: 4_000 });
    expect(result.behaviors.atStart).toEqual({ startMs: 250, endMs: 350 });
    expect(result.behaviors.onDone).toEqual({ startMs: 4_000, endMs: 4_100 });
    expect(result.behaviors.ownDone).toEqual({ startMs: 4_010, endMs: 4_110 });
  });

  test("a canvas out transition holds the finish", () => {
    const doc = compose(
      { video: {}, text: {} },
      { out: behavior("transition", "canvas", { anchor: "exit", durationMs: 800 }, { phase: "out" }) }
    );
    const result = resolveTimeline(doc, alert, facts(5_000, settled));
    expect(result.canvas).toEqual({ enterMs: 0, leaveMs: 4_000, exitMs: 4_800 });
    expect(result.finishMs).toBe(4_800);
  });

  test("behaviors on a missing target are skipped and reported", () => {
    const doc = compose({ text: {} }, { gone: behavior("effect", "deleted", {}) });
    const result = resolveTimeline(doc, alert, facts(0));
    expect(result.behaviors.gone).toBeUndefined();
    expect(result.problems).toEqual([{ behavior: "gone", kind: "dangling-target" }]);
  });
});

describe("activity", () => {
  test("a fixed window sets when the widget is active and holds the alert", () => {
    const doc = compose(
      { text: {} },
      { window: behavior("activity", "text", { anchor: "start", offsetMs: 500, durationMs: 8_000 }) }
    );
    const result = resolveTimeline(
      doc,
      alert,
      facts(600, { text: { subscribedAtMs: 550, timed: false, renderedAtMs: 520 } })
    );
    expect(result.widgets.text.enterMs).toBe(520);
    expect(result.widgets.text.exitMs).toBe(8_500);
    expect(result.endMs).toBe(8_500);
    expect(result.behaviors.window).toEqual({ startMs: 520, endMs: 8_500 });
  });

  test("an exit animation runs inside a fixed window", () => {
    const doc = compose(
      { text: {} },
      {
        window: behavior("activity", "text", { anchor: "start", offsetMs: 0, durationMs: 3_000 }),
        out: behavior("transition", "text", { anchor: "exit", durationMs: 500 }, { phase: "out" }),
      }
    );
    const result = resolveTimeline(
      doc,
      alert,
      facts(100, { text: { subscribedAtMs: 0, timed: false, renderedAtMs: 0 } })
    );
    expect(result.widgets.text.leaveMs).toBe(2_500);
    expect(result.widgets.text.exitMs).toBe(3_000);
    expect(result.behaviors.out).toEqual({ startMs: 2_500, endMs: 3_000 });
  });

  test("until-exit keeps the default exit while delaying the enter", () => {
    const doc = compose(
      { video: {}, text: {} },
      { window: behavior("activity", "text", { anchor: "start", offsetMs: 1_000, durationMs: "until-exit" }) }
    );
    const result = resolveTimeline(
      doc,
      alert,
      facts(5_000, {
        video: { subscribedAtMs: 0, timed: true, renderedAtMs: 0, completedAtMs: 4_000 },
        text: { subscribedAtMs: 1_000, timed: false, renderedAtMs: 900 },
      })
    );
    expect(result.widgets.text.enterMs).toBe(1_000);
    expect(result.widgets.text.exitMs).toBe(4_000);
  });

  test("a widget waits for another's completion", () => {
    const doc = compose(
      { video: {}, thanks: {} },
      {
        window: behavior("activity", "thanks", { anchor: "complete", node: "video", offsetMs: 200, durationMs: 2_000 }),
      }
    );
    const before = resolveTimeline(
      doc,
      alert,
      facts(1_000, { video: { subscribedAtMs: 0, timed: true, renderedAtMs: 0 } })
    );
    expect(before.widgets.thanks.enterMs).toBeNull();
    expect(before.endMs).toBeNull();
    const after = resolveTimeline(
      doc,
      alert,
      facts(4_300, {
        video: { subscribedAtMs: 0, timed: true, renderedAtMs: 0, completedAtMs: 4_000 },
        thanks: { subscribedAtMs: 4_100, timed: false, renderedAtMs: 4_100 },
      })
    );
    expect(after.widgets.thanks.enterMs).toBe(4_200);
    expect(after.widgets.thanks.exitMs).toBe(6_200);
    expect(after.endMs).toBe(6_200);
  });

  test("a widget waiting on one that never completes never enters", () => {
    const doc = compose(
      { broken: {}, thanks: {} },
      { window: behavior("activity", "thanks", { anchor: "complete", node: "broken", offsetMs: 0, durationMs: 1_000 }) }
    );
    const result = resolveTimeline(doc, alert, facts(SUBSCRIBE_TIMEOUT_MS));
    expect(result.widgets.broken.status).toBe("ignored");
    expect(result.widgets.thanks.status).toBe("never");
    expect(result.widgets.thanks.enterMs).toBeNull();
    expect(result.endMs).toBe(SUBSCRIBE_TIMEOUT_MS);
    expect(result.finishMs).toBe(SUBSCRIBE_TIMEOUT_MS);
  });

  test("a widget entering relative to the end does not hold it", () => {
    const doc = compose(
      { video: {}, outro: {} },
      { window: behavior("activity", "outro", { anchor: "end", offsetMs: 0, durationMs: 1_500 }) }
    );
    const result = resolveTimeline(
      doc,
      alert,
      facts(4_000, { video: { subscribedAtMs: 0, timed: true, renderedAtMs: 0, completedAtMs: 3_000 } })
    );
    expect(result.endMs).toBe(3_000);
    expect(result.widgets.outro.exitMs).toBe(4_500);
    expect(result.finishMs).toBe(4_500);
  });

  test("a window past the cap ends at the cap", () => {
    const doc = compose(
      { text: {} },
      { window: behavior("activity", "text", { anchor: "start", offsetMs: 0, durationMs: MAX_ALERT_MS + 60_000 }) }
    );
    const result = resolveTimeline(
      doc,
      alert,
      facts(100, { text: { subscribedAtMs: 0, timed: false, renderedAtMs: 0 } })
    );
    expect(result.endMs).toBe(MAX_ALERT_MS);
    expect(result.widgets.text.exitMs).toBe(MAX_ALERT_MS);
  });

  test("invalid, duplicate and cyclic activities fall back to the default and are reported", () => {
    const doc = compose(
      { a: {}, b: {}, c: {} },
      {
        self: behavior("activity", "a", { anchor: "enter", durationMs: 100 }),
        first: behavior("activity", "c", { anchor: "start", offsetMs: 100, durationMs: 1_000 }, {}, "a0"),
        second: behavior("activity", "c", { anchor: "start", offsetMs: 900, durationMs: 1_000 }, {}, "a1"),
        loopA: behavior("activity", "b", { anchor: "complete", node: "a", durationMs: 100 }),
        canvas: behavior("activity", "canvas", { anchor: "start", durationMs: 100 }),
      }
    );
    const result = resolveTimeline(doc, alert, facts(0));
    expect(result.problems).toEqual([
      { behavior: "canvas", kind: "invalid-activity" },
      { behavior: "second", kind: "duplicate-activity" },
      { behavior: "self", kind: "invalid-activity" },
    ]);
    const cyclic = compose(
      { a: {}, b: {} },
      {
        ab: behavior("activity", "a", { anchor: "complete", node: "b", durationMs: 100 }),
        ba: behavior("activity", "b", { anchor: "complete", node: "a", durationMs: 100 }),
      }
    );
    const looped = resolveTimeline(cyclic, alert, facts(0));
    expect(looped.problems).toEqual([
      { behavior: "ab", kind: "activity-cycle" },
      { behavior: "ba", kind: "activity-cycle" },
    ]);
    expect(looped.widgets.a.status).toBe("pending");
  });
});

describe("scene", () => {
  test("a widget is active while visible", () => {
    const doc = compose({ shown: {}, hidden: { visible: false } });
    const result = resolveTimeline(doc, scene, facts(100, { shown: { renderedAtMs: 0 }, hidden: { renderedAtMs: 0 } }));
    expect(result.widgets.shown).toMatchObject({ enterMs: 0, leaveMs: null, exitMs: null });
    expect(result.widgets.hidden).toMatchObject({ enterMs: null, exitMs: null });
    expect(result.endMs).toBeNull();
    expect(result.finishMs).toBeNull();
    expect(result.canvas).toEqual({ enterMs: 0, leaveMs: null, exitMs: null });
  });

  test("visibility toggles resolve the latest interval, with exit animations", () => {
    const doc = compose(
      { box: {} },
      {
        in: behavior("transition", "box", { anchor: "enter", durationMs: 300 }, { phase: "in" }),
        out: behavior("transition", "box", { anchor: "exit", durationMs: 400 }, { phase: "out" }),
      }
    );
    const hiddenThenShown = facts(20_000, {
      box: {
        renderedAtMs: 0,
        // Out of order on purpose: changes are applied by time.
        visibility: [
          { atMs: 10_000, visible: true },
          { atMs: 5_000, visible: false },
        ],
      },
    });
    const shown = resolveTimeline(doc, scene, hiddenThenShown);
    expect(shown.widgets.box).toMatchObject({ enterMs: 10_000, leaveMs: null, exitMs: null });
    expect(shown.behaviors.in).toEqual({ startMs: 10_000, endMs: 10_300 });
    expect(shown.behaviors.out).toEqual({ startMs: null, endMs: null });

    const hidden = resolveTimeline(
      doc,
      scene,
      facts(20_000, {
        box: {
          renderedAtMs: 0,
          visibility: [
            { atMs: 5_000, visible: false },
            { atMs: 10_000, visible: true },
            { atMs: 15_000, visible: false },
          ],
        },
      })
    );
    expect(hidden.widgets.box).toMatchObject({ enterMs: 10_000, leaveMs: 15_000, exitMs: 15_400 });
    expect(hidden.behaviors.out).toEqual({ startMs: 15_000, endMs: 15_400 });
  });

  test("a widget never times out in a scene", () => {
    const doc = compose({ box: {} });
    const result = resolveTimeline(doc, scene, facts(SUBSCRIBE_TIMEOUT_MS * 10, { box: { renderedAtMs: 0 } }));
    expect(result.widgets.box.status).toBe("pending");
  });

  test("an activity anchored to a completion opens within visibility", () => {
    const doc = compose(
      { video: {}, caption: {} },
      { window: behavior("activity", "caption", { anchor: "complete", node: "video", offsetMs: 0, durationMs: 2_000 }) }
    );
    const result = resolveTimeline(
      doc,
      scene,
      facts(7_000, {
        video: { renderedAtMs: 0, subscribedAtMs: 0, timed: true, completedAtMs: 6_000 },
        caption: { renderedAtMs: 0, visibility: [{ atMs: 7_000, visible: false }] },
      })
    );
    // Hidden at 7 s, before its window would close at 8 s.
    expect(result.widgets.caption).toMatchObject({ enterMs: 6_000, leaveMs: 7_000, exitMs: 7_000 });
  });

  test("anchors outside the profile are reported", () => {
    const doc = compose({ box: {} }, { atStart: behavior("effect", "box", { anchor: "start" }) });
    const result = resolveTimeline(doc, scene, facts(0));
    expect(result.behaviors.atStart).toEqual({ startMs: null, endMs: null });
    expect(result.problems).toEqual([{ behavior: "atStart", kind: "anchor-not-in-profile" }]);
  });
});

describe("estimates", () => {
  test("the editor draws an alert from settings.duration and explicit estimates", () => {
    const doc = compose(
      { video: { settings: { duration: 6 } }, sound: {}, text: {} },
      { out: behavior("transition", "video", { anchor: "exit", durationMs: 500 }, { phase: "out" }) }
    );
    const result = resolveTimeline(doc, alert, { startedAtMs: 0 }, { estimate: { durationsMs: { sound: 2_500 } } });
    expect(result.widgets.video).toEqual({
      status: "timed",
      enterMs: 0,
      completeMs: 6_000,
      leaveMs: 6_000,
      exitMs: 6_500,
    });
    expect(result.widgets.sound.completeMs).toBe(2_500);
    expect(result.widgets.sound.exitMs).toBe(2_500);
    expect(result.widgets.text.status).toBe("untimed");
    expect(result.endMs).toBe(6_000);
    expect(result.finishMs).toBe(6_500);
    expect(result.revisitAtMs).toBeNull();
  });

  test("an explicit null makes a widget untimed whatever its settings", () => {
    const doc = compose({ video: { settings: { duration: 6 } } });
    const result = resolveTimeline(doc, alert, { startedAtMs: 0 }, { estimate: { durationsMs: { video: null } } });
    expect(result.widgets.video.status).toBe("untimed");
    expect(result.endMs).toBe(UNTIMED_ALERT_MS);
  });

  test("a delayed widget's estimated length counts from its enter", () => {
    const doc = compose(
      { video: { settings: { duration: 3 } } },
      { window: behavior("activity", "video", { anchor: "start", offsetMs: 1_000, durationMs: "until-exit" }) }
    );
    const result = resolveTimeline(doc, alert, { startedAtMs: 0 }, { estimate: {} });
    expect(result.widgets.video.enterMs).toBe(1_000);
    expect(result.widgets.video.completeMs).toBe(4_000);
    expect(result.endMs).toBe(4_000);
  });

  test("observed facts win over estimates", () => {
    const doc = compose({ video: { settings: { duration: 6 } } });
    const result = resolveTimeline(doc, alert, facts(undefined, { video: { completedAtMs: 4_000 } }), { estimate: {} });
    expect(result.endMs).toBe(4_000);
  });
});

describe("determinism and facts", () => {
  test("the same input resolves the same, whatever the key order", () => {
    const behaviors = {
      b: behavior("transition", "y", { anchor: "exit", durationMs: 300 }, { phase: "out" }),
      a: behavior("activity", "x", { anchor: "complete", node: "y", offsetMs: 100, durationMs: 1_000 }),
    };
    const seen = {
      y: { subscribedAtMs: 0, timed: true, renderedAtMs: 0, completedAtMs: 2_000 },
      x: { subscribedAtMs: 2_100, timed: false, renderedAtMs: 2_100 },
    };
    const forward = resolveTimeline(compose({ x: {}, y: {} }, behaviors), alert, facts(3_000, seen));
    const reversed = resolveTimeline(
      compose({ y: {}, x: {} }, { a: behaviors.a, b: behaviors.b }),
      alert,
      facts(3_000, { x: seen.x, y: seen.y })
    );
    expect(reversed).toEqual(forward);
    expect(resolveTimeline(compose({ x: {}, y: {} }, behaviors), alert, facts(3_000, seen))).toEqual(forward);
  });

  test("later facts only fill in what was unknown", () => {
    const doc = compose(
      { video: {}, text: {} },
      { out: behavior("transition", "video", { anchor: "exit", durationMs: 300 }, { phase: "out" }) }
    );
    const steps: Array<[number, Record<string, WidgetFacts>]> = [
      [0, {}],
      [200, { text: { subscribedAtMs: 150, timed: false, renderedAtMs: 100 } }],
      [
        500,
        {
          text: { subscribedAtMs: 150, timed: false, renderedAtMs: 100 },
          video: { subscribedAtMs: 400, timed: true, renderedAtMs: 300 },
        },
      ],
      [
        3_000,
        {
          text: { subscribedAtMs: 150, timed: false, renderedAtMs: 100 },
          video: { subscribedAtMs: 400, timed: true, renderedAtMs: 300, completedAtMs: 2_900 },
        },
      ],
    ];
    let previous: ReturnType<typeof resolveTimeline> | null = null;
    for (const [now, seen] of steps) {
      const result = resolveTimeline(doc, alert, facts(now, seen));
      if (previous !== null) {
        for (const [id, widget] of Object.entries(previous.widgets)) {
          for (const key of ["enterMs", "completeMs", "leaveMs", "exitMs"] as const) {
            if (widget[key] !== null) {
              expect(result.widgets[id][key]).toBe(widget[key]);
            }
          }
        }
      }
      previous = result;
    }
    expect(previous?.finishMs).toBe(3_200);
  });

  test("malformed facts fail fast", () => {
    const doc = compose({ text: {} });
    expect(() => resolveTimeline(doc, alert, { startedAtMs: Number.NaN })).toThrow();
    expect(() => resolveTimeline(doc, alert, { startedAtMs: 0, widgets: { text: { subscribedAtMs: 1 } } })).toThrow(
      /timed/
    );
    expect(() =>
      resolveTimeline(doc, alert, { startedAtMs: 0 }, { estimate: { durationsMs: { text: -1 } } })
    ).toThrow();
  });
});

describe("mediaLengthEstimates", () => {
  const media = (widget: string, settings: Record<string, unknown>): PlacementDocument => ({
    widget,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    visible: true,
    z: "a0",
    settings,
    name: "",
    rotation: 0,
    opacity: 1,
    locked: false,
    extra: {},
  });

  test("only media at no length of its own, with a positive hint and not looping, is estimated", () => {
    const doc: CompositionDocument = {
      layout: { width: 100, height: 100 },
      behaviors: {},
      widgets: {
        video: media("woofx3:widget:video", { duration: 0, [MEDIA_LENGTH_HINT_SETTING]: 3 }),
        lottie: media("woofx3:widget:lottie", { [MEDIA_LENGTH_HINT_SETTING]: 1.5 }),
        timed: media("woofx3:widget:audio", { duration: 4, [MEDIA_LENGTH_HINT_SETTING]: 3 }),
        looping: media("woofx3:widget:video", { duration: 0, loop: true, [MEDIA_LENGTH_HINT_SETTING]: 3 }),
        noHint: media("woofx3:widget:audio", { duration: 0 }),
        badHint: media("woofx3:widget:audio", { duration: 0, [MEDIA_LENGTH_HINT_SETTING]: "3" }),
        image: media("woofx3:widget:image", { duration: 0, [MEDIA_LENGTH_HINT_SETTING]: 3 }),
      },
    };
    expect(mediaLengthEstimates(doc)).toEqual({ video: 3000, lottie: 1500 });
  });
});
