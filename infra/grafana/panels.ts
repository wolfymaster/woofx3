// A small vocabulary for the dashboards: panels are described by what they show, and
// `layout` places them in rows that share the 24-column grid evenly.

// biome-ignore lint/suspicious/noTemplateCurlyInString: Grafana datasource variable syntax
export const PROMETHEUS = { type: "prometheus", uid: "${ds_prom}" } as const;
// biome-ignore lint/suspicious/noTemplateCurlyInString: Grafana datasource variable syntax
export const LOKI = { type: "loki", uid: "${ds_loki}" } as const;

type Datasource = typeof PROMETHEUS | typeof LOKI;

export interface Target {
  expr: string;
  legend?: string;
  instant?: boolean;
}

export interface Panel {
  title: string;
  description?: string;
  kind: "stat" | "timeseries" | "table" | "logs";
  datasource: Datasource;
  targets: Target[];
  unit?: string;
  height?: number;
  stack?: boolean;
  /** Stat panels: red under this value, green above. */
  goodAbove?: number;
  /** Stat panels: green at zero, red above this value. */
  badAbove?: number;
  min?: number;
  max?: number;
  /** Table panels: the label the per-target rows are joined on, and a display name per refId. */
  joinOn?: string;
  columns?: Record<string, { name: string; unit?: string }>;
}

const GRID_WIDTH = 24;
const REFS = "ABCDEFGHIJKLMNOP";

export function layout(rows: Array<{ title: string; panels: Panel[] }>): unknown[] {
  const out: unknown[] = [];
  let y = 0;
  let id = 1;
  for (const row of rows) {
    out.push({
      type: "row",
      title: row.title,
      collapsed: false,
      gridPos: { h: 1, w: GRID_WIDTH, x: 0, y },
      id: id++,
      panels: [],
    });
    y += 1;
    const width = Math.floor(GRID_WIDTH / row.panels.length);
    const height = Math.max(...row.panels.map((panel) => panel.height ?? 7));
    row.panels.forEach((panel, index) => {
      out.push(render(panel, id++, { h: height, w: width, x: index * width, y }));
    });
    y += height;
  }
  return out;
}

function render(panel: Panel, id: number, gridPos: unknown): unknown {
  const targets = panel.targets.map((target, index) => ({
    refId: REFS[index],
    datasource: panel.datasource,
    expr: target.expr,
    legendFormat: target.legend ?? "",
    ...(panel.kind === "logs" ? { queryType: "range" } : {}),
    ...(target.instant || panel.kind === "stat" || panel.kind === "table" ? { instant: true, range: false } : {}),
    ...(panel.kind === "table" ? { format: "table" } : {}),
  }));
  const thresholds =
    panel.goodAbove !== undefined
      ? {
          mode: "absolute",
          steps: [
            { color: "red", value: null },
            { color: "green", value: panel.goodAbove },
          ],
        }
      : panel.badAbove !== undefined
        ? {
            mode: "absolute",
            steps: [
              { color: "green", value: null },
              { color: "red", value: panel.badAbove },
            ],
          }
        : { mode: "absolute", steps: [{ color: "green", value: null }] };
  return {
    id,
    type: panel.kind,
    title: panel.title,
    description: panel.description ?? "",
    datasource: panel.datasource,
    gridPos,
    targets,
    fieldConfig: {
      defaults: {
        unit: panel.unit ?? "short",
        thresholds,
        ...(panel.min !== undefined ? { min: panel.min } : {}),
        ...(panel.max !== undefined ? { max: panel.max } : {}),
        ...(panel.kind === "timeseries"
          ? { custom: { fillOpacity: panel.stack ? 25 : 8, stacking: { mode: panel.stack ? "normal" : "none" } } }
          : {}),
      },
      overrides: Object.entries(panel.columns ?? {}).map(([refId, column]) => ({
        matcher: { id: "byName", options: `Value #${refId}` },
        properties: [
          { id: "displayName", value: column.name },
          ...(column.unit ? [{ id: "unit", value: column.unit }] : []),
        ],
      })),
    },
    options:
      panel.kind === "stat"
        ? { colorMode: "background", reduceOptions: { calcs: ["lastNotNull"] } }
        : panel.kind === "logs"
          ? { showTime: true, wrapLogMessage: true, sortOrder: "Descending" }
          : panel.kind === "timeseries"
            ? { legend: { displayMode: "list", placement: "bottom" }, tooltip: { mode: "multi" } }
            : {},
    ...(panel.kind === "table"
      ? {
          transformations: [
            { id: "merge", options: {} },
            {
              id: "organize",
              options: {
                excludeByName: { Time: true },
                renameByName: { [panel.joinOn ?? "service_namespace"]: "Engine" },
              },
            },
          ],
        }
      : {}),
  };
}

export function dashboard(
  uid: string,
  title: string,
  description: string,
  variables: unknown[],
  panels: unknown[]
): unknown {
  return {
    uid,
    title,
    description,
    tags: ["woofx3", "engine"],
    timezone: "browser",
    schemaVersion: 39,
    refresh: "1m",
    time: { from: "now-6h", to: "now" },
    templating: { list: variables },
    panels,
  };
}

export const datasourceVariables = [
  { name: "ds_prom", label: "Metrics", type: "datasource", query: "prometheus", current: {}, hide: 0 },
  { name: "ds_loki", label: "Logs", type: "datasource", query: "loki", current: {}, hide: 0 },
];

/** `service.namespace` is the engine's slug; everything an engine sends carries it. */
export function engineVariable(multi: boolean): unknown {
  return {
    name: "engine",
    label: "Engine",
    type: "query",
    datasource: PROMETHEUS,
    query: { query: "label_values(woofx3_dependency_up_ratio, service_namespace)", refId: "engines" },
    refresh: 2,
    sort: 1,
    multi,
    includeAll: multi,
    current: multi ? { text: "All", value: "$__all" } : {},
  };
}
