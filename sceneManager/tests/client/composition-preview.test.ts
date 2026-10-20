import { describe, expect, it } from "bun:test";
import type { WidgetBehaviorState } from "@woofx3/module-sdk";
import type { BehaviorDocument, CompositionDocument, PlacementDocument } from "@woofx3/scene/model";
import {
  PREVIEW_FINISHED,
  PREVIEW_LOAD,
  PREVIEW_PLAYHEAD,
  PREVIEW_PROBLEMS,
  PREVIEW_READY,
  PREVIEW_TIMELINE,
  type PreviewReport,
  type RenderAnimation,
  type RenderElement,
  type RenderStyle,
} from "@woofx3/scene/runtime";
import type { SettingsReads } from "@woofx3/widget-host/page";
import {
  createCompositionPreview,
  type FrameResolution,
  PLAYHEAD_REPORT_MS,
  type PreviewFrameFacts,
  type PreviewFrameSpec,
} from "../../public/scene-manager/composition-preview";
import {
  createFrameResolver,
  parseFrameResolution,
  SESSION_EXPIRED_DETAIL,
} from "../../public/scene-manager/composition-preview-page";
import { SWAP_TIMEOUT_MS } from "../../public/scene-manager/frame-swap";

class FakeAnimation implements RenderAnimation {
  startTime: CSSNumberish | null = null;
  currentTime: CSSNumberish | null = null;
  paused = false;
  cancelled = false;

  pause(): void {
    this.paused = true;
  }

  cancel(): void {
    this.cancelled = true;
  }
}

class FakeElement implements RenderElement<FakeElement> {
  readonly style = {} as RenderStyle;
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly animations: FakeAnimation[] = [];
  parent: FakeElement | null = null;

  appendChild(child: FakeElement): unknown {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (this.parent !== null) {
      this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.parent = null;
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  animate(): RenderAnimation {
    const animation = new FakeAnimation();
    this.animations.push(animation);
    return animation;
  }

  /** Every element below this one with the attribute, depth first. */
  find(name: string, value: string): FakeElement | undefined {
    for (const child of this.children) {
      if (child.attributes.get(name) === value) {
        return child;
      }
      const found = child.find(name, value);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
}

class FakeClock {
  time = 10_000;
  private next = 1;
  private readonly timers = new Map<number, { atMs: number; callback: () => void }>();

  now(): number {
    return this.time;
  }

  setTimer(atMs: number, callback: () => void): number {
    const handle = this.next;
    this.next += 1;
    this.timers.set(handle, { atMs, callback });
    return handle;
  }

  clearTimer(handle: number): void {
    this.timers.delete(handle);
  }

  advanceBy(ms: number): void {
    const until = this.time + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.atMs <= until)
        .sort(([, a], [, b]) => a.atMs - b.atMs)[0];
      if (due === undefined) {
        break;
      }
      this.timers.delete(due[0]);
      this.time = Math.max(this.time, due[1].atMs);
      due[1].callback();
    }
    this.time = until;
  }
}

function placement(z: string, overrides: Partial<PlacementDocument> = {}): PlacementDocument {
  return {
    widget: "woofx3:widget:text",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    visible: true,
    z,
    settings: {},
    name: "",
    rotation: 0,
    opacity: 1,
    locked: false,
    extra: {},
    ...overrides,
  };
}

function transition(target: string, kind: string, phase: "in" | "out", order = "a0"): BehaviorDocument {
  return {
    type: "transition",
    kind,
    target,
    order,
    timing: { anchor: "enter", offsetMs: 0, durationMs: 500, easing: "ease-out" },
    params: { phase },
  };
}

/** One untimed widget fading in and out: shown 0..5000, exits by 5500. */
function faded(): CompositionDocument {
  return {
    layout: { width: 1920, height: 1080 },
    widgets: { w1: placement("a1") },
    behaviors: { in: transition("w1", "fade", "in"), out: transition("w1", "fade", "out", "a1") },
  };
}

interface MountedFrame {
  spec: PreviewFrameSpec;
  facts: PreviewFrameFacts;
  sent: Array<WidgetBehaviorState | null>;
  released: boolean;
  unmounted: boolean;
  revealed: boolean;
  /** What `settingsReads` answers; set by a test. */
  reads: SettingsReads | null;
  patched: Array<{ settings: Record<string, unknown>; mediaUrls: Record<string, string> }>;
}

function frameMeta(id: string, transitions: string[] = []) {
  return {
    frameUrl: `/frames/woofx3/${id}?v=1`,
    linkedResources: {},
    mediaUrls: {},
    behaviorKinds: { transitions, effects: [] },
  };
}

function setup(resolve?: (doc: CompositionDocument) => Promise<FrameResolution>) {
  const base = new FakeClock();
  const stage = new FakeElement();
  const reports: PreviewReport[] = [];
  const frames: MountedFrame[] = [];
  const fitted: Array<{ width: number; height: number }> = [];
  const preview = createCompositionPreview<FakeElement, number>({
    document: {
      createElement: () => new FakeElement(),
      timeline: {
        get currentTime() {
          return base.now();
        },
      },
    },
    stage,
    fitStage: (canvas) => fitted.push(canvas),
    baseClock: base,
    resolveFrames:
      resolve ??
      (async (doc) => ({
        widgets: Object.fromEntries(Object.keys(doc.widgets).map((id) => [id, frameMeta(id)])),
        problems: [],
      })),
    mountFrame: (_slot, spec, facts) => {
      const frame: MountedFrame = {
        spec,
        facts,
        sent: [],
        released: false,
        unmounted: false,
        revealed: !spec.swapping,
        reads: null,
        patched: [],
      };
      frames.push(frame);
      return {
        sendBehavior: (state) => frame.sent.push(state),
        release: () => {
          frame.released = true;
        },
        settingsReads: () => frame.reads,
        sendSettings: (settings, mediaUrls) => frame.patched.push({ settings, mediaUrls }),
        reveal: () => {
          frame.revealed = true;
        },
        unmount: () => {
          frame.unmounted = true;
        },
      };
    },
    post: (report) => reports.push(report),
  });
  const live = (id: string): MountedFrame => {
    const found = frames.filter((frame) => frame.spec.widgetId === id && !frame.unmounted);
    if (found.length !== 1) {
      throw new Error(`expected one live frame for ${id}, found ${found.length}`);
    }
    return found[0];
  };
  const of = <T extends PreviewReport["type"]>(type: T) =>
    reports.filter((report): report is Extract<PreviewReport, { type: T }> => report.type === type);
  const last = <T extends PreviewReport["type"]>(type: T) => of(type).at(-1);
  const visible = (id: string) => stage.find("data-scene-widget", id)?.style.visibility === "";
  return { base, stage, reports, frames, fitted, preview, live, of, last, visible };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function loaded(doc: CompositionDocument = faded(), extra: Record<string, unknown> = {}) {
  const harness = setup();
  harness.preview.handle({ type: PREVIEW_LOAD, loadId: "L1", profile: "alert", document: doc, ...extra });
  await settle();
  return harness;
}

describe("createCompositionPreview", () => {
  it("says it is ready, and ignores anything that is not a preview message", () => {
    const { reports, preview } = setup();
    preview.handle({ proto: "woofx3.widget", type: "hello" });
    preview.handle("hello");
    expect(reports).toEqual([{ type: PREVIEW_READY, protocol: 1 }]);
  });

  it("loads held at 0 ms: frames mounted for the alert surface, the timeline estimated, no event yet", async () => {
    const { live, last, fitted, visible } = await loaded(faded(), {
      event: { type: "twitch.follow", data: { user: "ana" } },
    });
    const frame = live("w1");
    expect(frame.spec).toMatchObject({
      surface: "alert",
      meta: frameMeta("w1"),
      event: { type: "twitch.follow", data: { user: "ana" } },
    });
    expect(frame.released).toBe(false);
    expect(fitted).toEqual([{ width: 1920, height: 1080 }]);
    expect(last(PREVIEW_TIMELINE)).toMatchObject({ loadId: "L1", durationMs: 5_500 });
    expect(last(PREVIEW_PLAYHEAD)).toEqual({ type: PREVIEW_PLAYHEAD, loadId: "L1", ms: 0, playing: false });
    expect(last(PREVIEW_PROBLEMS)).toEqual({ type: PREVIEW_PROBLEMS, loadId: "L1", problems: [] });
    expect(visible("w1")).toBe(true);
  });

  it("plays to the finish and holds there, reporting the playhead as it goes", async () => {
    const { base, preview, live, of, last, visible } = await loaded();
    preview.handle({ type: "woofx3.composition-preview.play" });
    expect(live("w1").released).toBe(true);
    base.advanceBy(PLAYHEAD_REPORT_MS * 3);
    expect(last(PREVIEW_PLAYHEAD)).toMatchObject({ ms: PLAYHEAD_REPORT_MS * 3, playing: true });
    base.advanceBy(6_000);
    expect(of(PREVIEW_FINISHED)).toEqual([{ type: PREVIEW_FINISHED, loadId: "L1", ms: 5_500 }]);
    expect(last(PREVIEW_PLAYHEAD)).toMatchObject({ ms: 5_500, playing: false });
    expect(visible("w1")).toBe(false);
    // Held: the frame stays mounted for scrubbing back.
    expect(live("w1").unmounted).toBe(false);
  });

  it("scrubs: a seek shows that moment, sets every animation to it, and finishes again on replay", async () => {
    const { base, preview, stage, of, visible } = await loaded();
    preview.handle({ type: "woofx3.composition-preview.play" });
    base.advanceBy(6_000);
    expect(of(PREVIEW_FINISHED)).toHaveLength(1);

    preview.handle({ type: "woofx3.composition-preview.seek", ms: 250 });
    expect(visible("w1")).toBe(true);
    const box = stage.find("data-scene-widget", "w1");
    const animations = box?.children[0]?.animations ?? [];
    expect(animations.length).toBeGreaterThan(0);
    for (const animation of animations) {
      expect(animation.currentTime).toBe(250);
    }

    preview.handle({ type: "woofx3.composition-preview.play" });
    base.advanceBy(6_000);
    expect(of(PREVIEW_FINISHED).map((report) => report.ms)).toEqual([5_500, 5_500]);
  });

  it("play at the finish starts over", async () => {
    const { base, preview, last } = await loaded();
    preview.handle({ type: "woofx3.composition-preview.play" });
    base.advanceBy(6_000);
    preview.handle({ type: "woofx3.composition-preview.play" });
    expect(last(PREVIEW_PLAYHEAD)).toMatchObject({ ms: 0, playing: true });
  });

  it("measures frames until the first pause, then holds the timeline still", async () => {
    const doc = faded();
    doc.widgets.w1 = { ...doc.widgets.w1, settings: { duration: 3 } };
    const { base, preview, live, last } = await loaded(doc);
    expect(last(PREVIEW_TIMELINE)?.durationMs).toBe(3_500);
    live("w1").facts.subscribed(true);
    preview.handle({ type: "woofx3.composition-preview.play" });
    base.advanceBy(1_200);
    live("w1").facts.completed();
    expect(last(PREVIEW_TIMELINE)?.durationMs).toBe(1_700);

    const harness = await loaded(doc);
    harness.live("w1").facts.subscribed(true);
    harness.preview.handle({ type: "woofx3.composition-preview.play" });
    harness.base.advanceBy(500);
    harness.preview.handle({ type: "woofx3.composition-preview.pause" });
    harness.preview.handle({ type: "woofx3.composition-preview.play" });
    harness.base.advanceBy(700);
    harness.live("w1").facts.completed();
    expect(harness.last(PREVIEW_TIMELINE)?.durationMs).toBe(3_500);
  });

  it("tells a widget again what it plays after a seek, with the time left, or none once over", async () => {
    const doc: CompositionDocument = {
      layout: { width: 800, height: 600 },
      widgets: { text: placement("a1") },
      behaviors: {
        typed: {
          ...transition("text", "typewriter", "in"),
          timing: { anchor: "enter", offsetMs: 0, durationMs: 1_000, easing: "linear" },
        },
      },
    };
    const harness = setup(async () => ({ widgets: { text: frameMeta("text", ["typewriter"]) }, problems: [] }));
    harness.preview.handle({ type: PREVIEW_LOAD, loadId: "L1", profile: "alert", document: doc });
    await settle();
    const { preview, live } = harness;
    const frame = live("text");
    expect(frame.spec.entrance).toMatchObject({ kind: "typewriter", phase: "in", durationMs: 1_000 });

    frame.sent.length = 0;
    preview.handle({ type: "woofx3.composition-preview.seek", ms: 400 });
    expect(frame.sent).toEqual([null, expect.objectContaining({ kind: "typewriter", durationMs: 600 })]);

    frame.sent.length = 0;
    preview.handle({ type: "woofx3.composition-preview.seek", ms: 3_000 });
    expect(frame.sent).toEqual([null, expect.objectContaining({ kind: "typewriter", durationMs: 0 })]);
  });

  it("skips a widget kind the widget does not declare, as an overlay does", async () => {
    const doc: CompositionDocument = {
      layout: { width: 800, height: 600 },
      widgets: { text: placement("a1") },
      behaviors: { typed: transition("text", "typewriter", "in") },
    };
    const { preview, live, last } = await loaded(doc);
    const frame = live("text");
    expect(frame.spec.entrance).toBeNull();
    preview.handle({ type: "woofx3.composition-preview.seek", ms: 100 });
    expect(frame.sent).toEqual([]);
    expect(last(PREVIEW_PROBLEMS)?.problems).toEqual([{ kind: "plan", id: "typed", detail: "undeclared-kind" }]);
  });

  it("binds inputs before playing, and plays nothing when they cannot be bound", async () => {
    const doc: CompositionDocument = {
      ...faded(),
      inputs: [{ id: "name", label: "Name", type: "string" }],
      widgets: { w1: placement("a1", { settings: { text: "Hello {{name}}" } }) },
    };
    const bound = await loaded(doc, { inputs: { name: "Ana" } });
    expect(bound.live("w1").spec.settings).toEqual({ text: "Hello Ana" });

    const unbound = await loaded(doc);
    expect(unbound.frames).toEqual([]);
    expect(unbound.last(PREVIEW_PROBLEMS)?.problems).toEqual([{ kind: "bind", id: "name", detail: "missing input" }]);
  });

  it("reports dropped entries and widgets the engine cannot frame, and plays the rest", async () => {
    const harness = setup(async () => ({
      widgets: { good: frameMeta("good") },
      problems: [{ kind: "unknown-widget", id: "gone" }],
    }));
    const doc: CompositionDocument = {
      layout: { width: 800, height: 600 },
      widgets: { good: placement("a1"), gone: placement("a2"), bad: { ...placement("a3"), opacity: 7 } },
      behaviors: {},
    };
    harness.preview.handle({ type: PREVIEW_LOAD, loadId: "L1", profile: "alert", document: doc });
    await settle();
    expect(harness.frames.map((frame) => frame.spec.widgetId)).toEqual(["good"]);
    expect(harness.last(PREVIEW_PROBLEMS)?.problems).toEqual([
      { kind: "invalid-entry", id: "bad", detail: expect.any(String) },
      { kind: "unknown-widget", id: "gone" },
    ]);
  });

  it("reports framing that failed", async () => {
    const harness = setup(async () => {
      throw new Error("engine down");
    });
    harness.preview.handle({ type: PREVIEW_LOAD, loadId: "L1", profile: "alert", document: faded() });
    await settle();
    expect(harness.last(PREVIEW_PROBLEMS)?.problems).toEqual([{ kind: "frames-unavailable", detail: "engine down" }]);
  });

  it("drops the framing answer for a load another one replaced", async () => {
    const answers: Array<() => void> = [];
    const harness = setup(
      (doc) =>
        new Promise((resolve) =>
          answers.push(() =>
            resolve({
              widgets: Object.fromEntries(Object.keys(doc.widgets).map((id) => [id, frameMeta(id)])),
              problems: [],
            })
          )
        )
    );
    const second: CompositionDocument = { ...faded(), widgets: { w2: placement("a1") }, behaviors: {} };
    harness.preview.handle({ type: PREVIEW_LOAD, loadId: "L1", profile: "alert", document: faded() });
    harness.preview.handle({ type: PREVIEW_LOAD, loadId: "L2", profile: "alert", document: second });
    for (const answer of answers) {
      answer();
    }
    await settle();
    expect(harness.frames.map((frame) => frame.spec.widgetId)).toEqual(["w2"]);
    expect(harness.of(PREVIEW_TIMELINE).map((report) => report.loadId)).toEqual(["L2"]);
  });

  it("lays overrides over the document and keeps them across a restart", async () => {
    const { preview, stage, frames, live, last } = await loaded();
    preview.handle({ type: "woofx3.composition-preview.overrides", overrides: { w1: { x: 40, y: 50 } } });
    const transform = () => stage.find("data-scene-widget", "w1")?.style.transform;
    expect(transform()).toBe("translate(40px, 50px) rotate(0deg)");

    preview.handle({ type: "woofx3.composition-preview.restart" });
    expect(frames).toHaveLength(2);
    expect(frames[0].unmounted).toBe(true);
    expect(live("w1").released).toBe(true);
    expect(transform()).toBe("translate(40px, 50px) rotate(0deg)");
    expect(last(PREVIEW_PLAYHEAD)).toMatchObject({ ms: 0, playing: true });
  });

  it("reports a message it cannot parse with no load", () => {
    const { preview, last } = setup();
    preview.handle({ type: "woofx3.composition-preview.seek", ms: "soon" });
    expect(last(PREVIEW_PROBLEMS)).toEqual({
      type: PREVIEW_PROBLEMS,
      loadId: null,
      problems: [{ kind: "invalid-message", detail: expect.stringContaining("seek") }],
    });
  });

  it("frames a scene profile on the scene surface, which never finishes", async () => {
    const harness = setup();
    harness.preview.handle({ type: PREVIEW_LOAD, loadId: "S", profile: "scene", document: faded(), autoplay: true });
    await settle();
    expect(harness.live("w1").spec.surface).toBe("scene");
    expect(harness.last(PREVIEW_TIMELINE)?.durationMs).toBeNull();
    harness.base.advanceBy(60_000);
    expect(harness.of(PREVIEW_FINISHED)).toEqual([]);
  });
});

describe("createCompositionPreview, loading an edit of what it plays", () => {
  type Harness = ReturnType<typeof setup>;

  async function reload(harness: Harness, doc: CompositionDocument, extra: Record<string, unknown> = {}) {
    harness.preview.handle({ type: PREVIEW_LOAD, loadId: "L2", profile: "alert", document: doc, ...extra });
    await settle();
  }

  function edited(edit: (w1: PlacementDocument) => PlacementDocument): CompositionDocument {
    const doc = faded();
    doc.widgets.w1 = edit(doc.widgets.w1);
    return doc;
  }

  const transform = (harness: Harness) => harness.stage.find("data-scene-widget", "w1")?.style.transform;

  it("moves a widget in place: no frame is mounted or unmounted", async () => {
    const harness = await loaded();
    await reload(
      harness,
      edited((w1) => ({ ...w1, x: 300, y: 20 }))
    );
    expect(harness.frames).toHaveLength(1);
    expect(harness.live("w1").unmounted).toBe(false);
    expect(transform(harness)).toBe("translate(300px, 20px) rotate(0deg)");
    expect(harness.last(PREVIEW_TIMELINE)?.loadId).toBe("L2");
    expect(harness.last(PREVIEW_PLAYHEAD)?.loadId).toBe("L2");
  });

  it("patches in settings the widget's script has not read, keeping its frame", async () => {
    const harness = await loaded();
    harness.live("w1").reads = { all: false, keys: new Set(["color"]) };
    await reload(
      harness,
      edited((w1) => ({ ...w1, settings: { text: "Thanks!" } }))
    );
    expect(harness.frames).toHaveLength(1);
    expect(harness.live("w1").patched).toEqual([{ settings: { text: "Thanks!" }, mediaUrls: {} }]);
  });

  it("swaps a frame whose script read a changed setting: the new one shows once it paints, then the old goes", async () => {
    const harness = await loaded();
    const old = harness.live("w1");
    old.reads = { all: false, keys: new Set(["text"]) };
    await reload(
      harness,
      edited((w1) => ({ ...w1, settings: { text: "Thanks!" } }))
    );
    expect(harness.frames).toHaveLength(2);
    const fresh = harness.frames[1];
    expect(fresh.spec).toMatchObject({ swapping: true, entrance: null, settings: { text: "Thanks!" } });
    expect(fresh.revealed).toBe(false);
    expect(old.unmounted).toBe(false);

    fresh.facts.rendered();
    expect(fresh.revealed).toBe(true);
    expect(old.unmounted).toBe(true);
    expect(harness.live("w1")).toBe(fresh);
  });

  it("swaps a frame whose document changed, showing it after the swap timeout when it never paints", async () => {
    let version = 1;
    const harness = setup(async (doc) => ({
      widgets: Object.fromEntries(
        Object.keys(doc.widgets).map((id) => [id, { ...frameMeta(id), frameUrl: `/frames/woofx3/${id}?v=${version}` }])
      ),
      problems: [],
    }));
    harness.preview.handle({ type: PREVIEW_LOAD, loadId: "L1", profile: "alert", document: faded() });
    await settle();
    const old = harness.live("w1");
    version = 2;
    await reload(harness, faded());
    const fresh = harness.frames[1];
    expect(fresh.spec.meta.frameUrl).toBe("/frames/woofx3/w1?v=2");
    expect(old.unmounted).toBe(false);
    harness.base.advanceBy(SWAP_TIMEOUT_MS);
    expect(fresh.revealed).toBe(true);
    expect(old.unmounted).toBe(true);
  });

  it("adds and removes widgets without touching the others", async () => {
    const harness = await loaded();
    const grown = faded();
    grown.widgets.w2 = placement("a2");
    await reload(harness, grown);
    expect(harness.frames.map((frame) => [frame.spec.widgetId, frame.unmounted])).toEqual([
      ["w1", false],
      ["w2", false],
    ]);
    // Part of the composition from its start, as on a fresh load.
    expect(harness.visible("w2")).toBe(true);

    await reload(harness, faded());
    expect(harness.frames.map((frame) => [frame.spec.widgetId, frame.unmounted])).toEqual([
      ["w1", false],
      ["w2", true],
    ]);
  });

  it("keeps a gesture's overrides on screen until the edit it committed is loaded", async () => {
    const answers: Array<() => void> = [];
    const harness = setup(
      (doc) =>
        new Promise((resolve) => {
          answers.push(() =>
            resolve({
              widgets: Object.fromEntries(Object.keys(doc.widgets).map((id) => [id, frameMeta(id)])),
              problems: [],
            })
          );
        })
    );
    harness.preview.handle({ type: PREVIEW_LOAD, loadId: "L1", profile: "alert", document: faded() });
    answers.shift()?.();
    await settle();
    harness.preview.handle({ type: "woofx3.composition-preview.overrides", overrides: { w1: { x: 300 } } });
    harness.preview.handle({
      type: PREVIEW_LOAD,
      loadId: "L2",
      profile: "alert",
      document: edited((w1) => ({ ...w1, x: 300 })),
    });
    await settle();
    expect(transform(harness)).toBe("translate(300px, 0px) rotate(0deg)");
    answers.shift()?.();
    await settle();
    expect(transform(harness)).toBe("translate(300px, 0px) rotate(0deg)");
    expect(harness.frames).toHaveLength(1);
  });

  it("mounts everything afresh for another sample event", async () => {
    const harness = await loaded(faded(), { event: { type: "twitch.follow", data: { user: "ana" } } });
    await reload(harness, faded(), { event: { type: "twitch.follow", data: { user: "bo" } } });
    expect(harness.frames.map((frame) => frame.unmounted)).toEqual([true, false]);
    expect(harness.live("w1").spec.event).toEqual({ type: "twitch.follow", data: { user: "bo" } });
  });
});

describe("parseFrameResolution", () => {
  it("keeps only frame documents and the problems it knows", () => {
    expect(
      parseFrameResolution({
        widgets: {
          a: {
            frameUrl: "/frames/woofx3/text?v=1",
            linkedResources: { list: "x", bad: 3 },
            mediaUrls: {},
            behaviorKinds: { transitions: ["typewriter"], effects: [] },
          },
          z: { frameUrl: "/frames/woofx3/z?v=1", behaviorKinds: { transitions: ["Not A Kind"], effects: [] } },
          b: { frameUrl: "https://elsewhere.test/evil" },
          c: null,
        },
        problems: [{ kind: "unknown-widget", id: "d" }, { kind: "made-up", id: "e" }, "nope"],
      })
    ).toEqual({
      widgets: {
        a: {
          frameUrl: "/frames/woofx3/text?v=1",
          linkedResources: { list: "x" },
          mediaUrls: {},
          behaviorKinds: { transitions: ["typewriter"], effects: [] },
        },
        z: {
          frameUrl: "/frames/woofx3/z?v=1",
          linkedResources: {},
          mediaUrls: {},
          behaviorKinds: { transitions: [], effects: [] },
        },
      },
      problems: [{ kind: "unknown-widget", id: "d" }],
    });
    expect(() => parseFrameResolution({})).toThrow();
  });
});

describe("createFrameResolver", () => {
  const doc = {
    layout: { width: 100, height: 100 },
    widgets: { a: { widget: "woofx3:widget:text", settings: {} } },
    behaviors: {},
  } as never;
  const answering = (response: Response) => {
    const calls: string[] = [];
    return { calls, fetchFn: async (url: string) => (calls.push(url), response) };
  };

  it("reads the engine's framing answer", async () => {
    const { fetchFn } = answering(
      Response.json({ widgets: { a: { frameUrl: "/frames/woofx3/text?v=1" } }, problems: [] })
    );
    const resolution = await createFrameResolver(fetchFn, () => false)(doc);
    expect(Object.keys(resolution.widgets)).toEqual(["a"]);
  });

  it("says the session expired when the engine refuses it, or when a renewal already was", async () => {
    const refused = answering(new Response(null, { status: 401 }));
    await expect(createFrameResolver(refused.fetchFn, () => false)(doc)).rejects.toThrow(SESSION_EXPIRED_DETAIL);
    const lapsed = answering(Response.json({ widgets: {}, problems: [] }));
    await expect(createFrameResolver(lapsed.fetchFn, () => true)(doc)).rejects.toThrow(SESSION_EXPIRED_DETAIL);
    expect(lapsed.calls).toEqual([]);
  });

  it("names any other refusal by its status", async () => {
    const { fetchFn } = answering(new Response(null, { status: 503 }));
    await expect(createFrameResolver(fetchFn, () => false)(doc)).rejects.toThrow("(503)");
  });
});
