import { describe, expect, test } from "bun:test";
import { PROFILES, resolveTimeline } from "../model";
import {
  COMPOSITION_PREVIEW_PROTOCOL,
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
  type PreviewReport,
  parsePreviewCommand,
  parsePreviewReport,
} from "../runtime";
import { behavior, composition, placement } from "./runtime-fixtures";

function load(overrides: Record<string, unknown> = {}) {
  return {
    type: PREVIEW_LOAD,
    loadId: "load-1",
    profile: "alert",
    document: composition({ w1: placement() }, { "w1-in": behavior() }),
    ...overrides,
  };
}

function refused(data: unknown): string {
  const parsed = parsePreviewCommand(data);
  if (parsed === null || parsed.ok) {
    throw new Error(`expected a refusal, got ${JSON.stringify(parsed)}`);
  }
  return parsed.error;
}

describe("parsePreviewCommand", () => {
  test("is null for anything that is not a preview message", () => {
    for (const data of [null, undefined, 3, "load", [], {}, { type: 7 }, { type: "woofx3.scene-preview.layout" }]) {
      expect(parsePreviewCommand(data)).toBeNull();
    }
  });

  test("reads a load, defaulting what it leaves out", () => {
    const parsed = parsePreviewCommand(load());
    expect(parsed).toEqual({
      ok: true,
      command: {
        type: PREVIEW_LOAD,
        loadId: "load-1",
        profile: "alert",
        document: composition({ w1: placement() }, { "w1-in": behavior() }),
        event: null,
        inputs: {},
        autoplay: false,
      },
      dropped: [],
    });
  });

  test("keeps a load's event, inputs and autoplay", () => {
    const parsed = parsePreviewCommand(
      load({ event: { type: "twitch.follow", data: { user: "ana" } }, inputs: { name: "ana" }, autoplay: true })
    );
    expect(parsed?.ok && parsed.command).toMatchObject({
      event: { type: "twitch.follow", data: { user: "ana" } },
      inputs: { name: "ana" },
      autoplay: true,
    });
  });

  test("converts an alert in the list shape a step stores", () => {
    const parsed = parsePreviewCommand(
      load({
        document: {
          width: 800,
          height: 600,
          widgets: [
            { id: "t", widgetCanonicalId: "woofx3:widget:text", position: { x: 1, y: 2, width: 3, height: 4 } },
          ],
        },
      })
    );
    expect(parsed?.ok && parsed.command.type === PREVIEW_LOAD && parsed.command.document.widgets.t).toMatchObject({
      widget: "woofx3:widget:text",
      x: 1,
      width: 3,
    });
  });

  test("drops entries that cannot be played and reports them, keeping the rest", () => {
    const doc = composition(
      { good: placement(), bad: { ...placement(), x: "left" } as never },
      {
        fine: behavior({ target: "good" }),
        broken: behavior({ target: "good", timing: { anchor: "enter", offsetMs: 0, durationMs: -5, easing: "ease" } }),
        future: { ...behavior({ target: "good" }), type: "sparkle", kind: "glitter" },
      }
    );
    const parsed = parsePreviewCommand(load({ document: doc }));
    if (parsed === null || !parsed.ok || parsed.command.type !== PREVIEW_LOAD) {
      throw new Error("expected a load");
    }
    expect(Object.keys(parsed.command.document.widgets)).toEqual(["good"]);
    // A type this build does not know is kept: the runtime skips it.
    expect(Object.keys(parsed.command.document.behaviors).sort()).toEqual(["fine", "future"]);
    expect(parsed.dropped.map(({ collection, id }) => [collection, id])).toEqual([
      ["widgets", "bad"],
      ["behaviors", "broken"],
    ]);
    expect(parsed.dropped.every(({ reason }) => reason.length > 0)).toBe(true);
  });

  test("refuses a load it cannot play", () => {
    expect(refused(load({ loadId: "" }))).toContain("loadId");
    expect(refused(load({ loadId: "x".repeat(129) }))).toContain("loadId");
    expect(refused(load({ profile: "overlay" }))).toContain("profile");
    expect(refused(load({ document: null }))).toContain("composition");
    expect(refused(load({ document: { layout: {}, widgets: [] } }))).toContain("composition");
    expect(refused(load({ document: { ...composition({}), layout: { width: 0, height: 10 } } }))).toContain("canvas");
    expect(refused(load({ document: { ...composition({}), inputs: {} } }))).toContain("inputs");
    expect(refused(load({ event: "follow" }))).toContain("event");
    expect(refused(load({ event: { data: {} } }))).toContain("event");
    expect(refused(load({ inputs: [] }))).toContain("inputs");
    expect(refused(load({ autoplay: "yes" }))).toContain("autoplay");
  });

  test("reads the transport commands", () => {
    for (const type of [PREVIEW_PLAY, PREVIEW_PAUSE, PREVIEW_RESTART] as const) {
      expect(parsePreviewCommand({ type })).toEqual({ ok: true, command: { type }, dropped: [] });
    }
    expect(parsePreviewCommand({ type: PREVIEW_SEEK, ms: 1500 })).toEqual({
      ok: true,
      command: { type: PREVIEW_SEEK, ms: 1500 },
      dropped: [],
    });
    expect(refused({ type: PREVIEW_SEEK })).toContain("seek");
    expect(refused({ type: PREVIEW_SEEK, ms: -1 })).toContain("seek");
    expect(refused({ type: PREVIEW_SEEK, ms: Number.NaN })).toContain("seek");
    expect(refused({ type: "woofx3.composition-preview.rewind" })).toContain("unknown");
  });

  test("reads overrides, ignoring keys it does not know", () => {
    expect(
      parsePreviewCommand({
        type: PREVIEW_OVERRIDES,
        overrides: { w1: { x: 10, y: 20, width: 30, height: 40, rotation: 5, opacity: 0.5, z: "a1", visible: false } },
      })
    ).toEqual({
      ok: true,
      command: {
        type: PREVIEW_OVERRIDES,
        overrides: { w1: { x: 10, y: 20, width: 30, height: 40, rotation: 5, opacity: 0.5, z: "a1" } },
      },
      dropped: [],
    });
    expect(parsePreviewCommand({ type: PREVIEW_OVERRIDES, overrides: null })).toEqual({
      ok: true,
      command: { type: PREVIEW_OVERRIDES, overrides: null },
      dropped: [],
    });
  });

  test("refuses overrides with a value the box cannot take", () => {
    expect(refused({ type: PREVIEW_OVERRIDES })).toContain("overrides");
    expect(refused({ type: PREVIEW_OVERRIDES, overrides: [] })).toContain("overrides");
    expect(refused({ type: PREVIEW_OVERRIDES, overrides: { w1: 3 } })).toContain("w1");
    expect(refused({ type: PREVIEW_OVERRIDES, overrides: { w1: { x: "1" } } })).toContain("x");
    expect(refused({ type: PREVIEW_OVERRIDES, overrides: { w1: { width: -1 } } })).toContain("size");
    expect(refused({ type: PREVIEW_OVERRIDES, overrides: { w1: { opacity: 2 } } })).toContain("opacity");
    expect(refused({ type: PREVIEW_OVERRIDES, overrides: { w1: { z: "" } } })).toContain("z");
  });

  test("never throws, whatever is posted", () => {
    const hostile = [
      load({ document: { layout: { width: 10, height: 10 }, widgets: { w: null }, behaviors: { b: 7 } } }),
      load({ document: { layout: { width: 10, height: 10 }, widgets: { w: { widget: 3 } }, behaviors: [] } }),
      load({ document: Object.create(null) }),
      { type: PREVIEW_OVERRIDES, overrides: { w: { z: 5 } } },
    ];
    for (const data of hostile) {
      expect(() => parsePreviewCommand(data)).not.toThrow();
      expect(parsePreviewCommand(data)).not.toBeNull();
    }
  });
});

describe("parsePreviewReport", () => {
  const timeline = resolveTimeline(
    composition({ w1: placement() }),
    PROFILES.alert,
    { startedAtMs: 0 },
    { estimate: {} }
  );

  test("reads every report the page sends", () => {
    const reports: PreviewReport[] = [
      { type: PREVIEW_READY, protocol: COMPOSITION_PREVIEW_PROTOCOL },
      { type: PREVIEW_TIMELINE, loadId: "l", timeline, durationMs: 5000 },
      { type: PREVIEW_TIMELINE, loadId: "l", timeline, durationMs: null },
      { type: PREVIEW_PLAYHEAD, loadId: "l", ms: 120, playing: true },
      { type: PREVIEW_FINISHED, loadId: "l", ms: 5000 },
      { type: PREVIEW_PROBLEMS, loadId: null, problems: [{ kind: "invalid-message", detail: "seek needs ms" }] },
      { type: PREVIEW_PROBLEMS, loadId: "l", problems: [{ kind: "unknown-widget", id: "w1" }] },
    ];
    for (const report of reports) {
      expect(parsePreviewReport(report)).toEqual({ ok: true, report });
    }
  });

  test("refuses a report that is not well formed, and ignores other messages", () => {
    expect(parsePreviewReport({ type: "woofx3.scene-preview.layout" })).toBeNull();
    const bad = [
      { type: PREVIEW_READY, protocol: 2 },
      { type: PREVIEW_TIMELINE, loadId: "l", timeline: {}, durationMs: 1 },
      { type: PREVIEW_TIMELINE, loadId: "l", timeline, durationMs: -1 },
      { type: PREVIEW_PLAYHEAD, loadId: "l", ms: 1 },
      { type: PREVIEW_FINISHED, ms: 1 },
      { type: PREVIEW_PROBLEMS, loadId: "l", problems: [{ kind: "made-up" }] },
      { type: PREVIEW_PROBLEMS, loadId: "l", problems: [{ kind: "plan", id: 3 }] },
      { type: "woofx3.composition-preview.mystery" },
    ];
    for (const report of bad) {
      expect(parsePreviewReport(report)?.ok).toBe(false);
    }
  });
});
