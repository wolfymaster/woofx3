import { describe, expect, it } from "bun:test";
import { AlertTimings, type PageMarks } from "../../public/scene-manager/alert-timing";

/** User Timing as a list of what is currently recorded. */
function fakeMarks() {
  const entries: Array<{ kind: "mark" | "measure"; name: string; detail?: unknown; start?: string; end?: string }> = [];
  const marks: PageMarks = {
    mark: (name, detail) => entries.push({ kind: "mark", name, detail }),
    measure: (name, start, end, detail) => entries.push({ kind: "measure", name, start, end, detail }),
    clear: (name) => {
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i]!.name === name) {
          entries.splice(i, 1);
        }
      }
    },
  };
  return { marks, entries, names: () => entries.map((entry) => entry.name) };
}

const AREA = "area-1";

describe("AlertTimings", () => {
  it("marks each step once, with the alert, area and widget in the detail", () => {
    const { marks, entries, names } = fakeMarks();
    const timings = new AlertTimings(marks);

    timings.alert("ev-1", AREA, "delivered");
    timings.alert("ev-1", AREA, "delivered");
    timings.frame("ev-1", AREA, "w1", "ready");

    expect(names()).toEqual(["woofx3.alert/ev-1/area-1/delivered", "woofx3.alert/ev-1/area-1/w1/ready"]);
    expect(entries[1]!.detail).toEqual({ eventId: "ev-1", areaId: AREA, widgetId: "w1", stage: "ready" });
  });

  it("marks the same alert separately in two areas", () => {
    const { marks, entries, names } = fakeMarks();
    const timings = new AlertTimings(marks);

    for (const area of ["a", "b"]) {
      timings.alert("ev-1", area, "delivered");
      timings.frame("ev-1", area, "w1", "rendered");
    }

    expect(names()).toEqual([
      "woofx3.alert/ev-1/a/delivered",
      "woofx3.alert/ev-1/a/w1/rendered",
      "woofx3.alert/ev-1/a/on-screen",
      "woofx3.alert/ev-1/b/delivered",
      "woofx3.alert/ev-1/b/w1/rendered",
      "woofx3.alert/ev-1/b/on-screen",
    ]);
    expect(entries.filter((entry) => entry.kind === "measure").map((entry) => entry.start)).toEqual([
      "woofx3.alert/ev-1/a/delivered",
      "woofx3.alert/ev-1/b/delivered",
    ]);
  });

  it("measures the alert on screen from its delivery to its first widget's paint", () => {
    const { marks, entries } = fakeMarks();
    const timings = new AlertTimings(marks);

    timings.alert("ev-1", AREA, "delivered");
    timings.alert("ev-1", AREA, "started");
    timings.frame("ev-1", AREA, "w1", "rendered");
    timings.frame("ev-1", AREA, "w2", "rendered");

    expect(entries.filter((entry) => entry.kind === "measure")).toEqual([
      {
        kind: "measure",
        name: "woofx3.alert/ev-1/area-1/on-screen",
        start: "woofx3.alert/ev-1/area-1/delivered",
        end: "woofx3.alert/ev-1/area-1/w1/rendered",
        detail: { eventId: "ev-1", areaId: AREA, from: "delivered" },
      },
    ]);
  });

  it("measures from the start of an alert delivered before this page was loaded, and says so", () => {
    const { marks, entries } = fakeMarks();
    const timings = new AlertTimings(marks);

    timings.alert("ev-1", AREA, "started");
    timings.frame("ev-1", AREA, "w1", "rendered");

    const measure = entries.find((entry) => entry.kind === "measure");
    expect(measure?.start).toBe("woofx3.alert/ev-1/area-1/started");
    expect(measure?.detail).toMatchObject({ from: "started" });
  });

  it("keeps the entries of the most recent finished alerts", () => {
    const { marks, names } = fakeMarks();
    const timings = new AlertTimings(marks, { retained: 2, tracked: 10 });

    for (const eventId of ["ev-1", "ev-2", "ev-3"]) {
      timings.alert(eventId, AREA, "delivered");
      timings.frame(eventId, AREA, "w1", "rendered");
      timings.alert(eventId, AREA, "finished");
    }

    expect(names().some((name) => name.startsWith("woofx3.alert/ev-1/"))).toBe(false);
    expect(names()).toContain("woofx3.alert/ev-2/area-1/on-screen");
    expect(names()).toContain("woofx3.alert/ev-3/area-1/w1/rendered");
  });

  it("keeps the delivery of queued alerts through a burst, so each still measures from it", () => {
    const { marks } = fakeMarks();
    const measured: unknown[] = [];
    const timings = new AlertTimings(
      { ...marks, measure: (name, start, end, detail) => measured.push(detail) },
      { retained: 2, tracked: 10 }
    );
    const burst = ["e1", "e2", "e3", "e4", "e5"];

    for (const eventId of burst) {
      timings.alert(eventId, AREA, "delivered");
    }
    for (const eventId of burst) {
      timings.alert(eventId, AREA, "started");
      timings.frame(eventId, AREA, "w1", "rendered");
      timings.alert(eventId, AREA, "finished");
    }

    expect(measured).toEqual(burst.map((eventId) => ({ eventId, areaId: AREA, from: "delivered" })));
  });

  it("stops tracking the oldest alerts that never finish", () => {
    const { marks, names } = fakeMarks();
    const timings = new AlertTimings(marks, { retained: 1, tracked: 2 });

    for (const eventId of ["ev-1", "ev-2", "ev-3"]) {
      timings.alert(eventId, AREA, "delivered");
    }

    expect(names()).toEqual(["woofx3.alert/ev-2/area-1/delivered", "woofx3.alert/ev-3/area-1/delivered"]);
  });

  it("refuses limits that keep nothing or track less than it keeps", () => {
    expect(() => new AlertTimings(fakeMarks().marks, { retained: 0, tracked: 5 })).toThrow();
    expect(() => new AlertTimings(fakeMarks().marks, { retained: 3, tracked: 2 })).toThrow();
  });
});
