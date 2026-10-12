import { describe, expect, it } from "bun:test";
import type { WidgetBehaviorState } from "@woofx3/module-sdk";
import {
  type BehaviorDocument,
  type CompositionDocument,
  MAX_ALERT_MS,
  type PlacementDocument,
  SUBSCRIBE_TIMEOUT_MS,
  UNTIMED_ALERT_MS,
} from "@woofx3/scene/model";
import type { RenderAnimation, RenderElement, RenderStyle } from "@woofx3/scene/runtime";
import { type AlertFrameFacts, parseDelivery, playAlert } from "../../public/scene-manager/alert-widget";

class FakeElement implements RenderElement<FakeElement> {
  readonly style = {} as RenderStyle;
  readonly children: FakeElement[] = [];
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

  setAttribute(): void {}

  animate(): RenderAnimation {
    return { startTime: null, currentTime: null, pause: () => {}, cancel: () => {} };
  }
}

/** A clock that moves only when a test advances it, firing due timers in order. */
class FakeClock {
  time = 0;
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

  advanceTo(atMs: number): void {
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.atMs <= atMs)
        .sort(([, a], [, b]) => a.atMs - b.atMs)[0];
      if (due === undefined) {
        break;
      }
      this.timers.delete(due[0]);
      this.time = Math.max(this.time, due[1].atMs);
      due[1].callback();
    }
    this.time = Math.max(this.time, atMs);
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

function alertOf(ids: string[], behaviors: Record<string, BehaviorDocument> = {}, hidden: string[] = []) {
  const widgets = Object.fromEntries(
    ids.map((id, index) => [id, placement(`a${index + 1}`, { visible: !hidden.includes(id) })])
  );
  return { layout: { width: 1920, height: 1080 }, widgets, behaviors } satisfies CompositionDocument;
}

function setup(doc: CompositionDocument) {
  const clock = new FakeClock();
  const stage = new FakeElement();
  const facts = new Map<string, AlertFrameFacts>();
  const sent: Array<[string, WidgetBehaviorState | null]> = [];
  const entrances = new Map<string, WidgetBehaviorState | null>();
  const unmounted: string[] = [];
  let finished: number | null = null;
  const player = playAlert({
    document: {
      createElement: () => new FakeElement(),
      timeline: {
        get currentTime() {
          return clock.now();
        },
      },
    },
    stage,
    doc,
    clock,
    mountFrame: (_slot, widgetId, entrance, frameFacts) => {
      facts.set(widgetId, frameFacts);
      entrances.set(widgetId, entrance);
      return {
        sendBehavior: (state) => sent.push([widgetId, state]),
        unmount: () => unmounted.push(widgetId),
      };
    },
    onFinished: () => {
      expect(finished).toBeNull();
      finished = clock.now();
    },
  });
  const frame = (id: string): AlertFrameFacts => {
    const found = facts.get(id);
    if (found === undefined) {
      throw new Error(`no frame for ${id}`);
    }
    return found;
  };
  return { clock, stage, frame, facts, sent, entrances, unmounted, player, finished: () => finished };
}

describe("playAlert", () => {
  it("lasts as long as its longest timed widget, then removes every frame", () => {
    const { clock, frame, finished, unmounted, stage } = setup(alertOf(["audio", "video", "text"]));
    frame("audio").subscribed(true);
    frame("video").subscribed(true);
    frame("text").subscribed(false);
    clock.advanceTo(500);
    frame("audio").completed();
    clock.advanceTo(1_000);
    expect(finished()).toBeNull();
    frame("video").completed();
    expect(finished()).toBe(1_000);
    expect(unmounted.sort()).toEqual(["audio", "text", "video"]);
    expect(stage.children).toEqual([]);
  });

  it("stays up for the untimed length when no widget has a length of its own", () => {
    const { clock, frame, finished } = setup(alertOf(["text", "image"]));
    frame("text").subscribed(false);
    frame("image").subscribed(false);
    frame("text").completed();
    clock.advanceTo(UNTIMED_ALERT_MS - 1);
    expect(finished()).toBeNull();
    clock.advanceTo(UNTIMED_ALERT_MS);
    expect(finished()).toBe(UNTIMED_ALERT_MS);
  });

  it("waits for a widget that has not subscribed, up to the subscribe timeout", () => {
    const { clock, frame, finished } = setup(alertOf(["audio", "slow"]));
    frame("audio").subscribed(true);
    frame("audio").completed();
    clock.advanceTo(SUBSCRIBE_TIMEOUT_MS - 1);
    expect(finished()).toBeNull();
    clock.advanceTo(SUBSCRIBE_TIMEOUT_MS);
    expect(finished()).toBe(SUBSCRIBE_TIMEOUT_MS);
  });

  it("ignores a completion from a widget it is not waiting on", () => {
    const { clock, frame, finished } = setup(alertOf(["video"]));
    frame("video").completed();
    frame("video").subscribed(true);
    clock.advanceTo(1);
    expect(finished()).toBeNull();
  });

  it("ends at the cap however long a widget runs", () => {
    const { clock, frame, finished } = setup(alertOf(["video"]));
    frame("video").subscribed(true);
    clock.advanceTo(MAX_ALERT_MS - 1);
    expect(finished()).toBeNull();
    clock.advanceTo(MAX_ALERT_MS);
    expect(finished()).toBe(MAX_ALERT_MS);
  });

  it("finishes only after the exit animations have played", () => {
    const out: BehaviorDocument = {
      type: "transition",
      kind: "fade",
      target: "text",
      order: "a0",
      timing: { anchor: "exit", offsetMs: 0, durationMs: 400, easing: "ease-in" },
      params: { phase: "out" },
    };
    const { clock, frame, finished } = setup(alertOf(["text"], { out }));
    frame("text").subscribed(false);
    frame("text").rendered();
    clock.advanceTo(UNTIMED_ALERT_MS);
    expect(finished()).toBeNull();
    clock.advanceTo(UNTIMED_ALERT_MS + 400);
    expect(finished()).toBe(UNTIMED_ALERT_MS + 400);
  });

  it("never mounts a hidden widget, and does not wait for it", () => {
    const { clock, frame, facts, finished } = setup(alertOf(["text", "sound"], {}, ["sound"]));
    expect([...facts.keys()]).toEqual(["text"]);
    frame("text").subscribed(false);
    clock.advanceTo(UNTIMED_ALERT_MS);
    expect(finished()).toBe(UNTIMED_ALERT_MS);
  });

  it("hands the widget its own transitions, marking the entrance from boot and sending it as the widget enters", () => {
    const typewriter: BehaviorDocument = {
      type: "transition",
      kind: "typewriter",
      target: "text",
      order: "a0",
      timing: { anchor: "enter", offsetMs: 0, durationMs: 800, easing: "ease-out" },
      params: { phase: "in" },
    };
    const fade: BehaviorDocument = { ...typewriter, kind: "fade", order: "a1" };
    const { clock, frame, sent, entrances } = setup(alertOf(["text"], { typewriter, fade }));
    const state: WidgetBehaviorState = {
      type: "transition",
      kind: "typewriter",
      phase: "in",
      durationMs: 800,
      easing: "ease-out",
      params: { phase: "in" },
    };
    expect(entrances.get("text")).toEqual(state);
    expect(sent).toEqual([]);
    clock.advanceTo(120);
    frame("text").rendered();
    expect(sent).toEqual([["text", state]]);
  });

  it("stops without reporting the alert finished", () => {
    const { clock, frame, player, finished, unmounted } = setup(alertOf(["text"]));
    player.stop();
    player.stop();
    expect(unmounted).toEqual(["text"]);
    frame("text").subscribed(false);
    clock.advanceTo(MAX_ALERT_MS);
    expect(finished()).toBeNull();
  });
});

describe("parseDelivery", () => {
  it("reads a composition, converts a list-shaped layout, and refuses one without a usable canvas", () => {
    const doc = alertOf(["text"]);
    expect(parseDelivery({ layout: doc, event: null })).toEqual({ layout: doc, event: null });
    const legacy = parseDelivery({
      layout: {
        width: 10,
        height: 10,
        widgets: [{ id: "t1", widgetCanonicalId: "woofx3:widget:text", position: { x: 1, y: 2, width: 3, height: 4 } }],
      },
      event: { type: "channel.follow", data: {} },
    });
    expect(legacy?.layout.widgets.t1).toMatchObject({ x: 1, y: 2, width: 3, height: 4, visible: true });
    expect(legacy?.event).toEqual({ type: "channel.follow", data: {} });
    expect(parseDelivery({ layout: { ...doc, layout: { width: 0, height: 10 } } })).toBeNull();
    expect(parseDelivery({ layout: { width: 10, height: 10 } })).toBeNull();
    expect(parseDelivery(null)).toBeNull();
  });
});
