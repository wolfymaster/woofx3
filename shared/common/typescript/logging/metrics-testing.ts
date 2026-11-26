import type { Meter } from "@opentelemetry/api";
import { MeterProvider, type MetricData, MetricReader } from "@opentelemetry/sdk-metrics";

class ManualReader extends MetricReader {
  protected async onShutdown(): Promise<void> {}
  protected async onForceFlush(): Promise<void> {}
}

/** One collected instrument: what a test asserts a metric's name, unit and attributes against. */
export interface CollectedMetric {
  name: string;
  unit: string;
  points: MetricData["dataPoints"];
}

/**
 * A MeterProvider with an in-memory reader, so a test can hand `meter` to the
 * code under test and read back what it recorded, without a collector.
 */
export class MetricsHarness {
  private readonly reader = new ManualReader();
  private readonly provider = new MeterProvider({ readers: [this.reader] });
  readonly meter: Meter = this.provider.getMeter("test");

  /** The named instrument as exported now; throws when nothing was recorded under that name. */
  async metric(name: string): Promise<CollectedMetric> {
    const { resourceMetrics, errors } = await this.reader.collect();
    if (errors.length > 0) {
      throw new Error(`metric collection failed: ${errors.map(String).join("; ")}`);
    }
    const found: MetricData | undefined = resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find((metric) => metric.descriptor.name === name);
    if (found === undefined) {
      throw new Error(`no metric named ${name} was recorded`);
    }
    return { name, unit: found.descriptor.unit, points: found.dataPoints };
  }

  async shutdown(): Promise<void> {
    await this.provider.shutdown();
  }
}
