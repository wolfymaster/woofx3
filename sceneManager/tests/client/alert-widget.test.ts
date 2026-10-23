import { describe, expect, it } from "bun:test";
import { RENDER_WAIT_MS, SUBSCRIBE_TIMEOUT_MS, UNTIMED_ALERT_MS } from "@woofx3/scene/model";
import type { RenderAnimation, RenderStyle } from "@woofx3/scene/runtime";
import {
  type AssetCache,
  EventQueueManager,
  type PageHost,
  type QueueRegistration,
  type WidgetBridge,
} from "@woofx3/widget-host/page";
import { AlertTimings } from "../../public/scene-manager/alert-timing";
import { AlertWidget } from "../../public/scene-manager/alert-widget";

class FakeElement {
  readonly style = {} as RenderStyle;
  readonly children: FakeElement[] = [];
  readonly contentWindow = { postMessage: () => {} };
  className = "";
  src = "";
  clientWidth = 1920;
  clientHeight = 1080;
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
  addEventListener(): void {}

  animate(): RenderAnimation {
    return { startTime: null, currentTime: null, pause: () => {}, cancel: () => {} };
  }
}

/** Timers that run only when the test advances them. */
class FakeTimers {
  time = 0;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();
  private next = 1;

  setTimeout = (callback: () => void, ms: number): number => {
    const handle = this.next++;
    this.timers.set(handle, { at: this.time + ms, callback });
    return handle;
  };
  clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };
  setInterval = (): number => 0;
  now = (): number => this.time;

  advance(ms: number): void {
    const until = this.time + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= until).sort(([, a], [, b]) => a.at - b.at)[0];
      if (due === undefined) {
        break;
      }
      this.timers.delete(due[0]);
      this.time = Math.max(this.time, due[1].at);
      due[1].callback();
    }
    this.time = until;
  }
}

/** A one-widget alert whose shape is set by `frame`. */
function alertOf(frame: string, widget = "woofx3:widget:text") {
  return {
    alertId: "a",
    layout: {
      layout: { width: 800, height: 600 },
      widgets: {
        t1: {
          widget,
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          visible: true,
          z: "a0",
          settings: {},
          name: "",
          rotation: 0,
          opacity: 1,
          locked: false,
          extra: {},
        },
      },
      behaviors: {},
    },
    frames: { t1: { frameUrl: `/frames/woofx3/${frame}?v=1`, linkedResources: {} } },
    event: null,
  };
}

/** Long enough for an alert of `alertOf` to play out: its widget never subscribes or paints. */
const ALERT_PLAYS_OUT_MS = RENDER_WAIT_MS + SUBSCRIBE_TIMEOUT_MS + UNTIMED_ALERT_MS + 1_000;

/** An alert widget wired to a real queue, as AlertAreas wires one. */
function setup(preparedAlerts?: number) {
  const timers = new FakeTimers();
  const element = new FakeElement();
  const host: PageHost = {
    timers,
    log: { warn: () => {} },
    randomBytes: (length) => new Uint8Array(length).fill(1),
  };
  const finished: string[] = [];
  const marked: string[] = [];
  const queues = new EventQueueManager(timers);
  let registration: QueueRegistration | null = null;
  let disposing = false;
  const widget = new AlertWidget({
    element: element as unknown as HTMLElement,
    instanceId: "area",
    bridges: new Set<WidgetBridge>(),
    postStatus: () => {},
    assets: { warm: () => {}, loaderFor: () => () => Promise.reject(new Error("no assets")) } as unknown as AssetCache,
    onFinished: (eventId) => {
      finished.push(eventId);
      if (registration !== null) {
        queues.complete(registration, eventId);
      }
    },
    waiting: () => (registration === null ? [] : queues.pending(registration)),
    document: {
      createElement: () => new FakeElement(),
      timeline: { currentTime: 0 },
    } as unknown as Document,
    clock: {
      now: () => timers.now(),
      setTimer: (atMs, callback) => timers.setTimeout(callback, Math.max(0, atMs - timers.now())),
      clearTimer: (handle) => timers.clearTimeout(handle),
    },
    host,
    timings: new AlertTimings({ mark: (name) => marked.push(name), measure: () => {}, clear: () => {} }),
    ...(preparedAlerts === undefined ? {} : { preparedAlerts }),
  });
  registration = queues.register(
    "area",
    { maxInFlight: 1 },
    (item) => !disposing && widget.play(item),
    () => {},
    (eventId) => widget.stop(eventId)
  );
  /** An alert reaches the page as the overlay hands it over: marked, then queued. */
  const deliver = (eventId: string, frame: string, canonicalId?: string) => {
    const value = alertOf(frame, canonicalId);
    widget.delivered(eventId, value);
    queues.enqueue("area", { eventId, type: "alert", key: eventId, value });
  };
  const cancel = (eventId: string) => queues.cancel("area", [eventId]);
  /** Frame URLs of the alert stages in the area, prepared or playing. */
  const stages = () =>
    element.children.map((stage) => {
      const frame = descendants(stage).find((child) => child.src !== "");
      return { frame: frame?.src.split("#")[0] ?? "", hidden: stage.style.opacity === "0" };
    });
  const dispose = () => {
    disposing = true;
    widget.dispose();
  };
  return { area: element, timers, finished, marked, stages, deliver, cancel, dispose };
}

function descendants(element: FakeElement): FakeElement[] {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}

const A = { frame: "/frames/woofx3/a?v=1", hidden: true };
const B = { frame: "/frames/woofx3/b?v=1", hidden: true };
const C = { frame: "/frames/woofx3/c?v=1", hidden: true };
const onScreen = (stage: { frame: string }) => ({ frame: stage.frame, hidden: false });

describe("AlertWidget", () => {
  it("prepares the shapes waiting in the queue, hidden, in the order they play", () => {
    const { timers, stages, deliver } = setup();
    deliver("ev-1", "a");
    deliver("ev-2", "b");
    deliver("ev-3", "c");
    deliver("ev-4", "b");

    timers.advance(0);

    expect(stages()).toEqual([onScreen(A), B, C]);
  });

  it("plays an alert on the stage prepared for its shape, marked as prepared", () => {
    const { timers, marked, stages, deliver } = setup();
    deliver("ev-1", "a");
    deliver("ev-2", "b");
    timers.advance(0);

    timers.advance(ALERT_PLAYS_OUT_MS);

    expect(stages()).toEqual([onScreen(B)]);
    expect(marked).toContain("woofx3.alert/ev-2/area/prepared");
  });

  it("does not mark an alert that arrives while the area is idle as prepared", () => {
    const { timers, marked, stages, deliver } = setup();
    deliver("ev-1", "a");
    timers.advance(0);

    expect(stages()).toEqual([onScreen(A)]);
    expect(marked).not.toContain("woofx3.alert/ev-1/area/prepared");
  });

  it("fits a prepared stage to the area as it is built, and again as it plays only if the area changed", () => {
    const { area, timers, deliver } = setup();
    area.clientWidth = 400;
    area.clientHeight = 300;
    deliver("ev-1", "a");
    deliver("ev-2", "b");
    timers.advance(0);
    const prepared = area.children[1]!;
    expect(prepared.style.opacity).toBe("0");
    expect(prepared.style.transform).toBe("translate(0px, 0px) scale(0.5)");

    area.clientWidth = 800;
    area.clientHeight = 600;
    timers.advance(ALERT_PLAYS_OUT_MS);

    expect(prepared.style.opacity).toBe("");
    expect(prepared.style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("marks what a prepared stage's frames did before the alert under the area it plays in", () => {
    const { timers, marked, deliver } = setup();
    deliver("ev-1", "a");
    deliver("ev-2", "b");
    timers.advance(0);
    expect(marked.filter((name) => name.startsWith("woofx3.alert/ev-2/"))).toEqual([
      "woofx3.alert/ev-2/area/delivered",
    ]);

    timers.advance(ALERT_PLAYS_OUT_MS);

    expect(marked.filter((name) => name.startsWith("woofx3.alert/ev-2/"))).toEqual([
      "woofx3.alert/ev-2/area/delivered",
      "woofx3.alert/ev-2/area/prepared",
      "woofx3.alert/ev-2/area/started",
      "woofx3.alert/ev-2/area/t1/mounted",
    ]);
  });

  it("marks an alert finished once, whichever way it leaves the stage", () => {
    const played = setup();
    played.deliver("ev-1", "a");
    played.timers.advance(ALERT_PLAYS_OUT_MS);
    played.timers.advance(ALERT_PLAYS_OUT_MS);

    const stopped = setup();
    stopped.deliver("ev-1", "a");
    stopped.cancel("ev-1");
    stopped.timers.advance(ALERT_PLAYS_OUT_MS);

    const disposed = setup();
    disposed.deliver("ev-1", "a");
    disposed.dispose();
    disposed.timers.advance(ALERT_PLAYS_OUT_MS);

    for (const { marked } of [played, stopped, disposed]) {
      expect(marked.filter((name) => name === "woofx3.alert/ev-1/area/finished")).toHaveLength(1);
    }
    expect(stopped.stages()).toEqual([A]);
  });

  it("finishes an alert whose widget has no canonical id, and prepares the shapes after it", () => {
    const { timers, finished, stages, deliver } = setup();
    deliver("ev-1", "a");
    deliver("ev-2", "bad", "text");
    deliver("ev-3", "b");

    timers.advance(0);
    expect(stages()).toEqual([onScreen(A), B]);

    timers.advance(ALERT_PLAYS_OUT_MS);
    expect(finished).toEqual(["ev-1", "ev-2"]);
    expect(stages()).toEqual([onScreen(B)]);
  });

  it("prepares nothing ahead when it keeps no prepared alerts", () => {
    const { timers, stages, deliver } = setup(0);
    deliver("ev-1", "a");
    deliver("ev-2", "b");
    timers.advance(10);

    expect(stages()).toEqual([onScreen(A)]);
  });

  it("prepares the next alert of a shape as one starts when another of it is waiting", () => {
    const { timers, stages, deliver } = setup();
    deliver("ev-1", "a");
    deliver("ev-2", "a");
    expect(stages()).toHaveLength(1);

    timers.advance(0);

    expect(stages()).toEqual([onScreen(A), A]);
  });

  it("prepares a shape nobody is waiting on only once nothing is on screen", () => {
    const { timers, stages, deliver } = setup();
    deliver("ev-1", "a");
    deliver("ev-2", "b");
    timers.advance(0);

    timers.advance(ALERT_PLAYS_OUT_MS);
    expect(stages()).toEqual([onScreen(B)]);

    timers.advance(ALERT_PLAYS_OUT_MS);
    expect(stages()).toEqual([B, A]);
  });

  it("forgets a waiting alert cancelled before it played", () => {
    const { timers, stages, deliver, cancel } = setup();
    deliver("ev-1", "a");
    deliver("ev-2", "a");
    timers.advance(0);
    cancel("ev-2");
    timers.advance(ALERT_PLAYS_OUT_MS);
    expect(stages()).toEqual([A]);

    deliver("ev-3", "a");
    timers.advance(0);

    expect(stages()).toEqual([onScreen(A)]);
  });

  it("keeps the stages due soonest when more shapes wait than it keeps", () => {
    const { timers, stages, deliver } = setup(2);
    deliver("ev-1", "a");
    deliver("ev-2", "b");
    deliver("ev-3", "a");
    deliver("ev-4", "c");

    timers.advance(0);

    expect(stages()).toEqual([onScreen(A), B, A]);
  });

  it("makes room for a waiting shape by dropping one nobody is waiting on", () => {
    const { timers, stages, deliver } = setup(1);
    deliver("ev-1", "a");
    timers.advance(ALERT_PLAYS_OUT_MS);
    expect(stages()).toEqual([A]);

    deliver("ev-2", "b");
    deliver("ev-3", "c");
    timers.advance(0);

    expect(stages()).toEqual([onScreen(B), C]);
  });

  it("drops what it prepared, and finishes what it plays, when it is disposed", () => {
    const { timers, finished, stages, deliver, dispose } = setup();
    deliver("ev-1", "a");
    deliver("ev-2", "b");
    timers.advance(0);

    dispose();

    expect(stages()).toEqual([]);
    expect(finished).toEqual(["ev-1"]);
  });

  it("refuses a negative number of prepared alerts", () => {
    expect(() => setup(-1)).toThrow();
  });
});
