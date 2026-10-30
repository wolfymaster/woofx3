import { describe, expect, test } from "bun:test";
import { alertRouteName, alertWidgetName, DEFAULT_ALERT_WIDGET_NAME, nextAlertWidgetName } from "../model/alert-names";

describe("alertRouteName", () => {
  const cases: { name: string; raw: unknown; route: string }[] = [
    { name: "a name", raw: "sidebar", route: "sidebar" },
    { name: "a name with spaces around it", raw: "  sidebar ", route: "sidebar" },
    { name: "a name with spaces inside", raw: "left side", route: "left side" },
    { name: "a blank name", raw: "   ", route: DEFAULT_ALERT_WIDGET_NAME },
    { name: "an empty name", raw: "", route: DEFAULT_ALERT_WIDGET_NAME },
    { name: "no name", raw: undefined, route: DEFAULT_ALERT_WIDGET_NAME },
    { name: "null", raw: null, route: DEFAULT_ALERT_WIDGET_NAME },
    { name: "a number", raw: 7, route: DEFAULT_ALERT_WIDGET_NAME },
    { name: "the default spelled out", raw: "default", route: DEFAULT_ALERT_WIDGET_NAME },
    { name: "a different case", raw: "Sidebar", route: "Sidebar" },
  ];

  for (const { name, raw, route } of cases) {
    test(`${name} -> ${JSON.stringify(route)}`, () => {
      expect(alertRouteName(raw)).toBe(route);
    });
  }
});

describe("alertWidgetName", () => {
  const cases: { name: string; settings: Record<string, unknown> | undefined; route: string }[] = [
    { name: "a named widget", settings: { name: " top " }, route: "top" },
    { name: "an unnamed widget", settings: { color: "red" }, route: DEFAULT_ALERT_WIDGET_NAME },
    { name: "no settings", settings: undefined, route: DEFAULT_ALERT_WIDGET_NAME },
    { name: "a name that is not text", settings: { name: ["top"] }, route: DEFAULT_ALERT_WIDGET_NAME },
  ];

  for (const { name, settings, route } of cases) {
    test(`${name} -> ${JSON.stringify(route)}`, () => {
      expect(alertWidgetName(settings)).toBe(route);
    });
  }
});

describe("nextAlertWidgetName", () => {
  const cases: { existing: string[]; next: string }[] = [
    { existing: [], next: DEFAULT_ALERT_WIDGET_NAME },
    { existing: ["sidebar"], next: DEFAULT_ALERT_WIDGET_NAME },
    { existing: ["default"], next: "alert-2" },
    { existing: ["default", "alert-2"], next: "alert-3" },
    { existing: ["default", "alert-3"], next: "alert-2" },
    { existing: ["default", "default"], next: "alert-2" },
  ];

  for (const { existing, next } of cases) {
    test(`${JSON.stringify(existing)} -> ${next}`, () => {
      expect(nextAlertWidgetName(existing)).toBe(next);
    });
  }
});
