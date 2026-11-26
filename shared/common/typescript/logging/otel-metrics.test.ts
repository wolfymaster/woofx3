import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { resolveConfig } from "./logger";
import { buildMeterProvider } from "./otel";

const envKeys = [
  "WOOFX3_OTEL_ENABLED",
  "WOOFX3_OTEL_EXPORTER_ENDPOINT",
  "WOOFX3_OTEL_METRICS_ENABLED",
  "WOOFX3_OTEL_METRICS_INTERVAL_MS",
  "WOOFX3_VERSION",
];

function clearEnv(): void {
  for (const key of envKeys) {
    delete process.env[key];
  }
}

describe("metrics config", () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  test("metrics are off when nothing is configured", () => {
    const config = resolveConfig();
    expect(config.otelMetricsEnabled).toBe(false);
    expect(config.otelMetricsIntervalMs).toBe(60_000);
  });

  test("an exporter endpoint turns metrics on", () => {
    process.env.WOOFX3_OTEL_EXPORTER_ENDPOINT = "http://localhost:4318";
    expect(resolveConfig().otelMetricsEnabled).toBe(true);
  });

  test("the master switch turns metrics off, and the override turns them off alone", () => {
    process.env.WOOFX3_OTEL_EXPORTER_ENDPOINT = "http://localhost:4318";
    process.env.WOOFX3_OTEL_ENABLED = "false";
    expect(resolveConfig().otelMetricsEnabled).toBe(false);
    process.env.WOOFX3_OTEL_ENABLED = "true";
    process.env.WOOFX3_OTEL_METRICS_ENABLED = "false";
    const config = resolveConfig();
    expect(config.otelEnabled).toBe(true);
    expect(config.otelMetricsEnabled).toBe(false);
  });

  test("the interval is configurable", () => {
    process.env.WOOFX3_OTEL_METRICS_INTERVAL_MS = "5000";
    expect(resolveConfig().otelMetricsIntervalMs).toBe(5000);
  });

  test.each(["0", "-1", "1.5", "soon"])("an interval of %s is refused at startup", (value) => {
    process.env.WOOFX3_OTEL_METRICS_INTERVAL_MS = value;
    expect(() => resolveConfig()).toThrow("WOOFX3_OTEL_METRICS_INTERVAL_MS");
  });
});

describe("buildMeterProvider", () => {
  test("a recorded measurement is exported with the engine's resource", async () => {
    process.env.WOOFX3_VERSION = "1.2.3";
    const config = resolveConfig({ otelResourceAttributes: { "service.namespace": "alpha" } });
    delete process.env.WOOFX3_VERSION;
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 3_600_000 });
    const provider = buildMeterProvider("api", config, reader);

    provider.getMeter("test").createCounter("woofx3.test", { unit: "1" }).add(2, { kind: "a" });
    await provider.forceFlush();

    const [batch] = exporter.getMetrics();
    expect(batch.resource.attributes["service.name"]).toBe("api");
    expect(batch.resource.attributes["service.namespace"]).toBe("alpha");
    const metric = batch.scopeMetrics[0].metrics[0];
    expect(metric.descriptor.name).toBe("woofx3.test");
    expect(metric.dataPoints[0].value).toBe(2);
    await provider.shutdown();
  });
});
