import { describe, expect, it } from "bun:test";
import { AlertTimings, type PageMarks } from "../../public/scene-manager/alert-timing";

/** User Timing as a list of what is currently recorded. */
function fakeMarks() {
  const entries: Array<{ kind: "mark" | "measure"; name: string; detail?: unknown; start?: string; end?: string }> = [];
  const marks: PageMarks = {
    mark: (name, detail) => entries.push({ kind: "mark", name, detail }),
    measure: (name, start, end) => entries.push({ kind: "measure", name, start, end }),
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

describe("AlertTimings", () => {
  it("marks each step once, with the alert and widget in the detail", () => {
    const { marks, entries, names } = fakeMarks();
    const timings = new AlertTimings(marks);

    timings.alert("ev-1", "delivered");
    timings.alert("ev-1", "delivered");
    timings.frame("ev-1", "w1", "ready");

    expect(names()).toEqual(["woofx3.alert/ev-1/delivered", "woofx3.alert/ev-1/w1/ready"]);
    expect(entries[1]!.detail).toEqual({ eventId: "ev-1", widgetId: "w1", stage: "ready" });
  });

  it("measures the alert on screen from its delivery to its first widget's paint", () => {
    const { marks, entries } = fakeMarks();
    const timings = new AlertTimings(marks);

    timings.alert("ev-1", "delivered");
    timings.alert("ev-1", "started");
    timings.frame("ev-1", "w1", "rendered");
    timings.frame("ev-1", "w2", "rendered");

    expect(entries.filter((entry) => entry.kind === "measure")).toEqual([
      {
        kind: "measure",
        name: "woofx3.alert/ev-1/on-screen",
        start: "woofx3.alert/ev-1/delivered",
        end: "woofx3.alert/ev-1/w1/rendered",
      },
    ]);
  });

  it("measures from the start of an alert delivered before this page was loaded", () => {
    const { marks, entries } = fakeMarks();
    const timings = new AlertTimings(marks);

    timings.alert("ev-1", "started");
    timings.frame("ev-1", "w1", "rendered");

    expect(entries.find((entry) => entry.kind === "measure")?.start).toBe("woofx3.alert/ev-1/started");
  });

  it("keeps only the most recent alerts' entries", () => {
    const { marks, names } = fakeMarks();
    const timings = new AlertTimings(marks, 2);

    for (const eventId of ["ev-1", "ev-2", "ev-3"]) {
      timings.alert(eventId, "delivered");
      timings.frame(eventId, "w1", "rendered");
    }

    expect(names().some((name) => name.startsWith("woofx3.alert/ev-1/"))).toBe(false);
    expect(names()).toContain("woofx3.alert/ev-2/on-screen");
    expect(names()).toContain("woofx3.alert/ev-3/w1/rendered");
  });

  it("refuses to keep fewer than one alert", () => {
    expect(() => new AlertTimings(fakeMarks().marks, 0)).toThrow();
  });
});
