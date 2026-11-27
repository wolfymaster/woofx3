# Fleet dashboards

Grafana dashboards for the telemetry every engine sends (`service.namespace` is the engine's slug):

| Dashboard | Answers |
|---|---|
| Fleet overview | Which engines are up, receiving events and processing alerts, and which are failing or quiet |
| Engine detail | One engine: dependencies, platform connection, events and lag, alerts, workflows, module functions, delivery to the dashboard, database and message handling, logs |

They use the metrics listed in `docs/services/runtime.md` and the engine's logs in Loki. Traces are not on them: trace context does not cross services yet, so there is no end-to-end trace to show.

The dashboards pick their data sources from variables, so they work on any stack with a Prometheus and a Loki data source.

```bash
bun infra/grafana/build.ts   # regenerate dashboards/*.json from build.ts
GRAFANA_URL=https://<stack>.grafana.net GRAFANA_TOKEN=<service account token> bun infra/grafana/push.ts
```

`GRAFANA_TOKEN` is a service account token with the editor role, not the ingest token engines use. Metric names are written once at the top of `build.ts`, in the form the OTLP-to-Prometheus translation gives them.
