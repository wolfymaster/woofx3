import { AlertTimings } from "../../public/scene-manager/alert-timing";
import { describe, expect, it } from "bun:test";
import { EventQueueManager, type QueuedEvent } from "@woofx3/widget-host/page";
import { type AlertArea, AlertAreas } from "../../public/scene-manager/alert-areas";
import type { AlertWidgetOptions } from "../../public/scene-manager/alert-widget";

class FakeElement {
  className = "";
  readonly children: FakeElement[] = [];
  appendChild(child: FakeElement): void {
    this.children.push(child);
  }
  remove(): void {}
}

/** An area that plays one alert at a time and finishes it when told, or when disposed. */
class FakeArea implements AlertArea {
  readonly played: string[] = [];
  private current: string | null = null;
  constructor(private readonly options: AlertWidgetOptions) {}
  play(item: QueuedEvent): boolean {
    this.played.push(item.eventId);
    this.current = item.eventId;
    return true;
  }
  finish(): void {
    const id = this.current;
    this.current = null;
    if (id !== null) {
      this.options.onFinished(id);
    }
  }
  stop(): void {
    this.finish();
  }
  dispose(): void {
    this.finish();
  }
  delivered(): void {}
}

function setup() {
  const queues = new EventQueueManager();
  const areas: FakeArea[] = [];
  const acks: string[] = [];
  const alertAreas = new AlertAreas({
    document: { createElement: () => new FakeElement() } as never,
    sceneBase: "/scene/s1",
    bridges: new Set(),
    queues,
    assets: {} as never,
    postStatus: () => {},
    ackAlert: (kind, eventId) => acks.push(`${kind} ${eventId}`),
    rendered: () => {},
    timings: new AlertTimings({ mark: () => {}, measure: () => {}, clear: () => {} }),
    createArea: (options) => {
      const area = new FakeArea(options);
      areas.push(area);
      return area;
    },
  });
  const deliver = (eventId: string) => queues.enqueue("area", { eventId, type: "alert", key: "", value: null });
  return { alertAreas, queues, areas, acks, deliver };
}

describe("AlertAreas", () => {
  it("starts nothing on an area being torn down", () => {
    const { alertAreas, areas, acks, deliver } = setup();
    const unmount = alertAreas.mount("area", new FakeElement() as never);
    deliver("e1");
    deliver("e2");
    unmount();
    expect(areas[0]!.played).toEqual(["e1"]);
    expect(acks).toEqual(["started e1", "completed e1"]);
  });

  it("keeps the new area's alerts and read-ahead when the old one is retired after it", () => {
    const { alertAreas, areas, deliver } = setup();
    const unmountOld = alertAreas.mount("area", new FakeElement() as never);
    for (const id of ["e1", "e2", "e3"]) {
      deliver(id);
    }
    alertAreas.mount("area", new FakeElement() as never);
    unmountOld();
    expect(areas[0]!.played).toEqual(["e1"]);
    expect(areas[1]!.played).toEqual(["e2"]);
    areas[1]!.finish();
    expect(areas[1]!.played).toEqual(["e2", "e3"]);
  });
});
