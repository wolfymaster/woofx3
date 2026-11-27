import { describe, expect, it, mock } from "bun:test";
import { MetricsHarness } from "@woofx3/common/logging/metrics-testing";
import { registerDependencyMetrics } from "../src/dependency-metrics";

const logger = { debug: mock(() => {}) } as any;

describe("registerDependencyMetrics", () => {
  it("reports 1 or 0 per dependency, down for a probe that rejects, and nothing for an unknown one", async () => {
    const harness = new MetricsHarness();
    registerDependencyMetrics(
      harness.meter,
      {
        nats: () => true,
        db: async () => {
          throw new Error("unreachable");
        },
        barkloader: () => false,
        convex_queue: () => null,
      },
      logger
    );

    const up = await harness.metric("woofx3.dependency.up");

    expect(up.unit).toBe("1");
    const byDependency = Object.fromEntries(up.points.map((point) => [point.attributes.dependency, point.value]));
    expect(byDependency).toEqual({ nats: 1, db: 0, barkloader: 0 });
  });

  it("reads the probes again at every collection", async () => {
    const harness = new MetricsHarness();
    let nats = true;
    registerDependencyMetrics(harness.meter, { nats: () => nats }, logger);

    await harness.metric("woofx3.dependency.up");
    nats = false;
    const up = await harness.metric("woofx3.dependency.up");

    expect(up.points.map((point) => point.value)).toEqual([0]);
  });
});
