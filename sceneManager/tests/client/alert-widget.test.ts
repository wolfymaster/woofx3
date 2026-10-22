import { describe, expect, it } from "bun:test";
import type { RenderAnimation, RenderStyle } from "@woofx3/scene/runtime";
import type { AssetCache, PageHost, WidgetBridge } from "@woofx3/widget-host/page";
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
function alertOf(frame: string) {
  return {
    alertId: "a",
    layout: {
      layout: { width: 800, height: 600 },
      widgets: {
        t1: {
          widget: "woofx3:widget:text",
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

function setup(preparedAlerts?: number) {
  const timers = new FakeTimers();
  const element = new FakeElement();
  const host: PageHost = {
    timers,
    log: { warn: () => {} },
    randomBytes: (length) => new Uint8Array(length).fill(1),
  };
  const finished: string[] = [];
  const widget = new AlertWidget({
    element: element as unknown as HTMLElement,
    bridges: new Set<WidgetBridge>(),
    postStatus: () => {},
    assets: { warm: () => {}, loaderFor: () => () => Promise.reject(new Error("no assets")) } as unknown as AssetCache,
    onFinished: (eventId) => finished.push(eventId),
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
    timings: new AlertTimings({ mark: () => {}, measure: () => {}, clear: () => {} }),
    ...(preparedAlerts === undefined ? {} : { preparedAlerts }),
  });
  /** Frame URLs of the alert stages in the area, prepared or playing. */
  const stages = () =>
    element.children.map((stage) => {
      const frame = descendants(stage).find((child) => child.src !== "");
      return { frame: frame?.src.split("#")[0] ?? "", hidden: stage.style.opacity === "0" };
    });
  return { widget, timers, finished, stages };
}

function descendants(element: FakeElement): FakeElement[] {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}

describe("AlertWidget", () => {
  it("prepares each shape it is delivered, hidden, and keeps the most recently wanted", () => {
    const { widget, stages } = setup(2);

    widget.delivered("ev-1", alertOf("a"));
    widget.delivered("ev-2", alertOf("b"));
    widget.delivered("ev-3", alertOf("a"));
    widget.delivered("ev-4", alertOf("c"));

    expect(stages()).toEqual([
      { frame: "/frames/woofx3/a?v=1", hidden: true },
      { frame: "/frames/woofx3/c?v=1", hidden: true },
    ]);
  });

  it("plays an alert on the stage prepared for its shape", () => {
    const { widget, stages } = setup();
    widget.delivered("ev-1", alertOf("a"));

    widget.play({ eventId: "ev-1", type: "alert", key: "a", value: alertOf("a") });

    expect(stages()).toEqual([{ frame: "/frames/woofx3/a?v=1", hidden: false }]);
  });

  it("prepares nothing ahead when it keeps no prepared alerts", () => {
    const { widget, timers, stages } = setup(0);
    widget.delivered("ev-1", alertOf("a"));
    expect(stages()).toEqual([]);

    widget.play({ eventId: "ev-1", type: "alert", key: "a", value: alertOf("a") });
    timers.advance(10);

    expect(stages()).toEqual([{ frame: "/frames/woofx3/a?v=1", hidden: false }]);
  });

  it("prepares the next alert of a shape as one starts when another of it is waiting", () => {
    const { widget, timers, stages } = setup();
    widget.delivered("ev-1", alertOf("a"));
    widget.delivered("ev-2", alertOf("a"));

    widget.play({ eventId: "ev-1", type: "alert", key: "a", value: alertOf("a") });
    expect(stages()).toHaveLength(1);
    timers.advance(0);

    expect(stages()).toEqual([
      { frame: "/frames/woofx3/a?v=1", hidden: false },
      { frame: "/frames/woofx3/a?v=1", hidden: true },
    ]);
  });

  it("waits for an alert to finish before preparing the next of its shape when none is waiting", () => {
    const { widget, timers, stages } = setup();
    widget.delivered("ev-1", alertOf("a"));
    widget.play({ eventId: "ev-1", type: "alert", key: "a", value: alertOf("a") });
    timers.advance(0);
    expect(stages()).toHaveLength(1);
  });

  it("drops what it prepared, and finishes what it plays, when it is disposed", () => {
    const { widget, finished, stages } = setup();
    widget.delivered("ev-1", alertOf("a"));
    widget.delivered("ev-2", alertOf("b"));
    widget.play({ eventId: "ev-1", type: "alert", key: "a", value: alertOf("a") });

    widget.dispose();

    expect(stages()).toEqual([]);
    expect(finished).toEqual(["ev-1"]);
  });

  it("refuses a negative number of prepared alerts", () => {
    expect(() => setup(-1)).toThrow();
  });
});
