import { describe, expect, test } from "bun:test";
import {
  type AlertTargetUse,
  alertStepTargets,
  alertTargetUsage,
  alertWidgetNamesAcross,
  alertWidgetNamesOf,
  orphanedAlertTargets,
  placedWidgetsOf,
} from "../alert-targets";

const ALERT_WIDGET = "woofx3:widget:alert";
const TEXT_WIDGET = "woofx3:widget:text";
const ALERT_WIDGETS: ReadonlySet<string> = new Set([ALERT_WIDGET]);

describe("alertStepTargets", () => {
  const cases: { name: string; steps: unknown[]; targets: string[] }[] = [
    { name: "no steps", steps: [], targets: [] },
    {
      name: "alert steps in order",
      steps: [
        { action: "alert", parameters: { target: "sidebar" } },
        { action: "alert", parameters: { target: " top " } },
      ],
      targets: ["sidebar", "top"],
    },
    {
      name: "a step with no target plays on the default",
      steps: [
        { action: "alert", parameters: {} },
        { action: "alert" },
        { action: "alert", parameters: { target: "" } },
      ],
      targets: ["default", "default", "default"],
    },
    {
      name: "other actions are not alert steps",
      steps: [
        { action: "function", parameters: { target: "sidebar" } },
        { action: "Alert", parameters: { target: "x" } },
      ],
      targets: [],
    },
    {
      name: "entries that are not steps",
      steps: [null, "alert", 7, ["alert"], { parameters: { target: "x" } }],
      targets: [],
    },
    {
      name: "parameters that are not an object",
      steps: [
        { action: "alert", parameters: ["sidebar"] },
        { action: "alert", parameters: "sidebar" },
      ],
      targets: ["default", "default"],
    },
  ];

  for (const { name, steps, targets } of cases) {
    test(name, () => {
      expect(alertStepTargets(steps)).toEqual(targets);
    });
  }
});

describe("placedWidgetsOf", () => {
  const cases: { name: string; entries: unknown[]; placed: ReturnType<typeof placedWidgetsOf> }[] = [
    {
      name: "an entry with settings",
      entries: [{ id: "w-1", widgetCanonicalId: ALERT_WIDGET, settings: { name: "top" } }],
      placed: [{ widgetId: ALERT_WIDGET, settings: { name: "top" } }],
    },
    {
      name: "an entry stored under the older widget field",
      entries: [{ id: "w-1", widgetDefinitionRef: ALERT_WIDGET }],
      placed: [{ widgetId: ALERT_WIDGET, settings: undefined }],
    },
    {
      name: "settings that are not an object",
      entries: [{ widgetCanonicalId: TEXT_WIDGET, settings: ["x"] }],
      placed: [{ widgetId: TEXT_WIDGET, settings: undefined }],
    },
    {
      name: "entries that name no widget",
      entries: [{ id: "w-1" }, { widgetCanonicalId: "" }, { widgetCanonicalId: 7 }],
      placed: [],
    },
    { name: "entries that are not objects", entries: [null, "w-1", [ALERT_WIDGET]], placed: [] },
  ];

  for (const { name, entries, placed } of cases) {
    test(name, () => {
      expect(placedWidgetsOf(entries)).toEqual(placed);
    });
  }
});

describe("alertWidgetNamesOf", () => {
  test("names only the widgets that host alerts, unnamed ones as the default", () => {
    const placed = placedWidgetsOf([
      { widgetCanonicalId: ALERT_WIDGET, settings: { name: "top" } },
      { widgetCanonicalId: ALERT_WIDGET },
      { widgetCanonicalId: TEXT_WIDGET, settings: { name: "sidebar" } },
    ]);
    expect([...alertWidgetNamesOf(placed, ALERT_WIDGETS)].sort()).toEqual(["default", "top"]);
  });

  test("no widget hosts alerts", () => {
    const placed = placedWidgetsOf([{ widgetCanonicalId: ALERT_WIDGET, settings: { name: "top" } }]);
    expect(alertWidgetNamesOf(placed, new Set()).size).toBe(0);
  });
});

const SCENES = [
  { id: "scene-a", widgets: [{ widgetCanonicalId: ALERT_WIDGET }] },
  { id: "scene-b", widgets: [{ widgetCanonicalId: ALERT_WIDGET, settings: { name: "sidebar" } }] },
  { id: "scene-c", widgets: [{ widgetCanonicalId: TEXT_WIDGET, settings: { name: "ghost" } }] },
];

describe("alertWidgetNamesAcross", () => {
  test("every scene's alert widget names, once each", () => {
    const scenes = [...SCENES, { id: "scene-d", widgets: [{ widgetCanonicalId: ALERT_WIDGET }] }];
    expect([...alertWidgetNamesAcross(scenes, ALERT_WIDGETS)].sort()).toEqual(["default", "sidebar"]);
  });

  test("no scenes", () => {
    expect(alertWidgetNamesAcross([], ALERT_WIDGETS).size).toBe(0);
  });
});

describe("alertTargetUsage", () => {
  const players = [
    {
      kind: "workflow" as const,
      name: "Follow alert",
      steps: [{ action: "alert", parameters: { target: "sidebar" } }],
    },
    { kind: "command" as const, name: "!hype", steps: [{ action: "alert" }, { action: "function" }] },
  ];

  test("leaves the edited scene out of elsewhere and lists every use", () => {
    expect(alertTargetUsage("scene-b", { scenes: SCENES, players, alertWidgetIds: ALERT_WIDGETS })).toEqual({
      alertWidgetIds: [ALERT_WIDGET],
      elsewhere: ["default"],
      uses: [
        { target: "sidebar", kind: "workflow", name: "Follow alert" },
        { target: "default", kind: "command", name: "!hype" },
      ],
    });
  });

  test("a scene id no scene has leaves every scene in elsewhere", () => {
    const usage = alertTargetUsage("scene-x", { scenes: SCENES, players: [], alertWidgetIds: ALERT_WIDGETS });
    expect(usage.elsewhere.sort()).toEqual(["default", "sidebar"]);
    expect(usage.uses).toEqual([]);
  });
});

describe("orphanedAlertTargets", () => {
  const uses: AlertTargetUse[] = [
    { target: "sidebar", kind: "workflow", name: "Follow alert" },
    { target: "sidebar", kind: "workflow", name: "Follow alert" },
    { target: "sidebar", kind: "command", name: "!hype" },
    { target: "top", kind: "workflow", name: "Raid alert" },
    { target: "never", kind: "workflow", name: "Sub alert" },
  ];

  const cases: {
    name: string;
    before: string[];
    after: string[];
    elsewhere: string[];
    orphaned: ReturnType<typeof orphanedAlertTargets>;
  }[] = [
    {
      name: "renaming a widget orphans the steps that played on its old name, each listed once",
      before: ["sidebar", "top"],
      after: ["side", "top"],
      elsewhere: [],
      orphaned: [
        {
          target: "sidebar",
          uses: [
            { target: "sidebar", kind: "workflow", name: "Follow alert" },
            { target: "sidebar", kind: "command", name: "!hype" },
          ],
        },
      ],
    },
    {
      name: "another scene still answering keeps the target",
      before: ["sidebar"],
      after: [],
      elsewhere: ["sidebar"],
      orphaned: [],
    },
    {
      name: "an edit that keeps every name orphans nothing",
      before: ["top"],
      after: ["top"],
      elsewhere: [],
      orphaned: [],
    },
    {
      name: "a target nothing answered to before is not the edit's doing",
      before: [],
      after: [],
      elsewhere: [],
      orphaned: [],
    },
  ];

  for (const { name, before, after, elsewhere, orphaned } of cases) {
    test(name, () => {
      expect(orphanedAlertTargets(uses, new Set(before), new Set(after), new Set(elsewhere))).toEqual(orphaned);
    });
  }
});
