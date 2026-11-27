// Writes the fleet dashboards to ./dashboards/*.json.  Run: bun infra/grafana/build.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dashboard, datasourceVariables, engineVariable, LOKI, layout, type Panel, PROMETHEUS } from "./panels";

// Prometheus names for each OTel instrument after the OTLP translation: dots become underscores, a unit of
// seconds is appended, counters gain _total, and a gauge of unit "1" gains _ratio. Kept in one place so a
// rename in the pipeline is one edit.
const m = {
  eventsReceived: "woofx3_events_received_total",
  lastReceived: "woofx3_events_last_received_time_seconds",
  ingestLag: "woofx3_event_ingest_lag_seconds_bucket",
  alerts: "woofx3_alerts_total",
  alertDepth: "woofx3_alerts_queue_depth",
  alertWait: "woofx3_alerts_queue_wait_seconds_bucket",
  pipeline: "woofx3_event_pipeline_duration_seconds_bucket",
  dependency: "woofx3_dependency_up_ratio",
  platformUp: "woofx3_platform_connection_up_ratio",
  reconnects: "woofx3_platform_reconnects_total",
  shipQueue: "woofx3_event_shipper_queue_size",
  shipDropped: "woofx3_event_shipper_dropped_total",
  shipPost: "woofx3_event_shipper_post_duration_seconds_bucket",
  shipFailures: "woofx3_event_shipper_post_failures_total",
  runs: "woofx3_workflow_runs_total",
  runDuration: "woofx3_workflow_run_duration_seconds_bucket",
  runsActive: "woofx3_workflow_runs_active",
  stepDuration: "woofx3_workflow_step_duration_seconds_bucket",
  barkloader: "woofx3_barkloader_function_duration_seconds_bucket",
  messaging: "messaging_process_duration_seconds_bucket",
  rpcClient: "rpc_client_duration_seconds_bucket",
  rpcServer: "rpc_server_duration_seconds_bucket",
};

const ns = (selector: string) => `service_namespace=~"${selector}"`;
const fleet = ns("$engine");
const R = "$__rate_interval";
const p = (q: number, metric: string, selector: string, by = "") =>
  `histogram_quantile(${q}, sum by (le${by ? `, ${by}` : ""}) (rate(${metric}{${selector}}[${R}])))`;
const perSecond = (metric: string, selector: string, by: string) =>
  `sum by (${by}) (rate(${metric}{${selector}}[${R}]))`;

function ts(title: string, expr: string, unit: string, legend = "", extra: Partial<Panel> = {}): Panel {
  return { title, kind: "timeseries", datasource: PROMETHEUS, targets: [{ expr, legend }], unit, ...extra };
}

function latency(title: string, metric: string, selector: string, by = "", description = ""): Panel {
  return {
    title,
    description,
    kind: "timeseries",
    datasource: PROMETHEUS,
    unit: "s",
    targets: [
      { expr: p(0.5, metric, selector, by), legend: by ? `p50 {{${by}}}` : "p50" },
      { expr: p(0.95, metric, selector, by), legend: by ? `p95 {{${by}}}` : "p95" },
    ],
  };
}

const fleetDashboard = dashboard(
  "woofx3-fleet",
  "woofx3 / Fleet overview",
  "Is every engine up, receiving events and processing alerts? One row per engine below; open Engine detail for one.",
  [...datasourceVariables, engineVariable(true)],
  layout([
    {
      title: "Fleet health",
      panels: [
        {
          title: "Engines reporting",
          description: "Engines that sent a dependency reading in the last few minutes.",
          kind: "stat",
          datasource: PROMETHEUS,
          targets: [{ expr: `count(count by (service_namespace) (${m.dependency}{${fleet}}))` }],
          height: 5,
        },
        {
          title: "Engines with a dependency down",
          kind: "stat",
          datasource: PROMETHEUS,
          targets: [{ expr: `count(count by (service_namespace) (${m.dependency}{${fleet}} == 0)) or vector(0)` }],
          badAbove: 1,
          height: 5,
        },
        {
          title: "Platform connections down",
          kind: "stat",
          datasource: PROMETHEUS,
          targets: [{ expr: `count(${m.platformUp}{${fleet}} == 0) or vector(0)` }],
          badAbove: 1,
          height: 5,
        },
        {
          title: "Alert failure rate (1h)",
          kind: "stat",
          datasource: PROMETHEUS,
          unit: "percentunit",
          targets: [
            {
              expr: `sum(increase(${m.alerts}{${fleet},outcome="failed"}[1h])) / clamp_min(sum(increase(${m.alerts}{${fleet}}[1h])), 1)`,
            },
          ],
          badAbove: 0.05,
          height: 5,
        },
        {
          title: "Events dropped before delivery (1h)",
          kind: "stat",
          datasource: PROMETHEUS,
          targets: [{ expr: `sum(increase(${m.shipDropped}{${fleet}}[1h])) or vector(0)` }],
          badAbove: 1,
          height: 5,
        },
      ],
    },
    {
      title: "Every engine",
      panels: [
        {
          title: "Engine status",
          description: "One row per engine. Sort by a column to find the quiet or failing ones.",
          kind: "table",
          datasource: PROMETHEUS,
          joinOn: "service_namespace",
          height: 10,
          targets: [
            { expr: `sum by (service_namespace) (rate(${m.eventsReceived}{${fleet}}[5m])) * 60` },
            { expr: `sum by (service_namespace) (rate(${m.alerts}{${fleet},outcome="queued"}[5m])) * 60` },
            {
              expr: `sum by (service_namespace) (increase(${m.alerts}{${fleet},outcome="failed"}[1h])) / clamp_min(sum by (service_namespace) (increase(${m.alerts}{${fleet}}[1h])), 1)`,
            },
            { expr: `time() - max by (service_namespace) (${m.lastReceived}{${fleet}})` },
            { expr: `min by (service_namespace) (${m.dependency}{${fleet}})` },
            { expr: `min by (service_namespace) (${m.platformUp}{${fleet}})` },
            { expr: `sum by (service_namespace) (increase(${m.shipDropped}{${fleet}}[1h]))` },
          ],
          columns: {
            A: { name: "Events / min" },
            B: { name: "Alerts / min" },
            C: { name: "Alert failures (1h)", unit: "percentunit" },
            D: { name: "Since last event", unit: "s" },
            E: { name: "Dependencies up (1 = all)" },
            F: { name: "Platform up (1 = yes)" },
            G: { name: "Events dropped (1h)" },
          },
        },
      ],
    },
    {
      title: "Traffic",
      panels: [
        ts(
          "Events received per second, by engine",
          perSecond(m.eventsReceived, fleet, "service_namespace"),
          "ops",
          "{{service_namespace}}"
        ),
        ts("Alerts by outcome, fleet", perSecond(m.alerts, fleet, "outcome"), "ops", "{{outcome}}", { stack: true }),
        latency(
          "Event ingest lag, fleet",
          m.ingestLag,
          fleet,
          "",
          "Platform timestamp to arrival, for events whose payload carries a timestamp."
        ),
      ],
    },
    {
      title: "Logs",
      panels: [
        {
          title: "Error logs per minute, by engine",
          kind: "timeseries",
          datasource: LOKI,
          unit: "short",
          targets: [
            {
              expr: `sum by (service_namespace) (count_over_time({service_namespace=~"$engine"} | detected_level="error" [1m]))`,
              legend: "{{service_namespace}}",
            },
          ],
        },
        {
          title: "Recent errors, fleet",
          kind: "logs",
          datasource: LOKI,
          targets: [{ expr: `{service_namespace=~"$engine"} | detected_level="error"` }],
          height: 9,
        },
      ],
    },
  ])
);

const one = ns("$engine");
const detailDashboard = dashboard(
  "woofx3-engine",
  "woofx3 / Engine detail",
  "One engine: health, events, alerts, workflows, modules, delivery to the dashboard, and its logs.",
  [...datasourceVariables, engineVariable(false)],
  layout([
    {
      title: "Health",
      panels: [
        {
          title: "Dependencies",
          description: "1 while the engine reaches the dependency and it answers.",
          kind: "stat",
          datasource: PROMETHEUS,
          targets: [{ expr: `min by (dependency) (${m.dependency}{${one}})`, legend: "{{dependency}}" }],
          goodAbove: 1,
          height: 5,
        },
        {
          title: "Platform connection",
          kind: "stat",
          datasource: PROMETHEUS,
          targets: [{ expr: `min by (platform) (${m.platformUp}{${one}})`, legend: "{{platform}}" }],
          goodAbove: 1,
          height: 5,
        },
        {
          title: "Since the last event",
          description: "Climbing while a stream is live means events stopped arriving.",
          kind: "stat",
          datasource: PROMETHEUS,
          unit: "s",
          targets: [{ expr: `time() - max by (platform) (${m.lastReceived}{${one}})`, legend: "{{platform}}" }],
          badAbove: 900,
          height: 5,
        },
        {
          title: "Platform reconnects (1h)",
          kind: "stat",
          datasource: PROMETHEUS,
          targets: [{ expr: `sum by (platform) (increase(${m.reconnects}{${one}}[1h]))`, legend: "{{platform}}" }],
          badAbove: 3,
          height: 5,
        },
      ],
    },
    {
      title: "Events",
      panels: [
        ts("Received per second, by type", perSecond(m.eventsReceived, one, "event_type"), "ops", "{{event_type}}", {
          stack: true,
        }),
        latency(
          "Ingest lag",
          m.ingestLag,
          one,
          "platform",
          "Platform timestamp to arrival (follows and redemptions carry a timestamp)."
        ),
      ],
    },
    {
      title: "Alerts",
      panels: [
        ts("By outcome", perSecond(m.alerts, one, "outcome"), "ops", "{{outcome}}", { stack: true }),
        ts("Waiting for a page to start them", `sum(${m.alertDepth}{${one}})`, "short", "queue depth"),
        latency("Queue wait", m.alertWait, one, "", "Recorded for a widget to a page reporting it started."),
        latency(
          "Dispatch time by stage",
          m.pipeline,
          one,
          "stage",
          "Time an alert's dispatch spent in each stage before any page heard of it."
        ),
      ],
    },
    {
      title: "Workflows and modules",
      panels: [
        ts("Runs by outcome", perSecond(m.runs, one, "outcome"), "ops", "{{outcome}}", { stack: true }),
        ts("Running now", `sum(${m.runsActive}{${one}})`, "short", "active runs"),
        latency("Run duration", m.runDuration, one, "outcome"),
        latency("Step duration, by action", m.stepDuration, one, "step_action"),
        latency("Module function duration", m.barkloader, one, "function_name"),
      ],
    },
    {
      title: "Delivery to the dashboard",
      panels: [
        ts("Buffered, by target", `sum by (target) (${m.shipQueue}{${one}})`, "short", "{{target}}"),
        {
          title: "Dropped events and failed POSTs",
          description: "Failed POSTs are the early warning; dropped events mean data was lost.",
          kind: "timeseries",
          datasource: PROMETHEUS,
          unit: "ops",
          targets: [
            { expr: `sum(rate(${m.shipFailures}{${one}}[${R}]))`, legend: "failed POSTs" },
            { expr: `sum(rate(${m.shipDropped}{${one}}[${R}]))`, legend: "dropped events" },
          ],
        },
        latency("POST duration", m.shipPost, one, "target"),
      ],
    },
    {
      title: "Plumbing",
      panels: [
        latency("Message handler time, by subscription", m.messaging, one, "messaging_destination_name"),
        latency("Database calls from the engine", m.rpcClient, one, "rpc_method"),
        latency("Database proxy serving time", m.rpcServer, one, "rpc_method"),
        ts(
          "Failed calls and handlers",
          `sum by (error_type) (rate(${m.rpcClient}{${one},error_type!=""}[${R}])) or sum by (error_type) (rate(${m.messaging}{${one},error_type!=""}[${R}]))`,
          "ops",
          "{{error_type}}"
        ),
      ],
    },
    {
      title: "Logs",
      panels: [
        {
          title: "Log volume by level",
          kind: "timeseries",
          datasource: LOKI,
          targets: [
            {
              expr: `sum by (detected_level) (count_over_time({service_namespace="$engine"} [1m]))`,
              legend: "{{detected_level}}",
            },
          ],
          stack: true,
        },
        {
          title: "Errors and warnings by service",
          kind: "timeseries",
          datasource: LOKI,
          targets: [
            {
              expr: `sum by (service_name) (count_over_time({service_namespace="$engine"} | detected_level=~"error|warn" [1m]))`,
              legend: "{{service_name}}",
            },
          ],
        },
        {
          title: "Recent errors",
          kind: "logs",
          datasource: LOKI,
          targets: [{ expr: `{service_namespace="$engine"} | detected_level="error"` }],
          height: 10,
        },
      ],
    },
  ])
);

const out = join(import.meta.dir, "dashboards");
mkdirSync(out, { recursive: true });
for (const [name, body] of [
  ["fleet-overview", fleetDashboard],
  ["engine-detail", detailDashboard],
] as const) {
  writeFileSync(join(out, `${name}.json`), `${JSON.stringify(body, null, 2)}\n`);
}
