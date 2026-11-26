import { describe, expect, test } from "bun:test";
import { MetricsHarness } from "@woofx3/common/logging/metrics-testing";
import { PlatformConnectionMetrics } from "./platformMetrics";

describe("PlatformConnectionMetrics", () => {
  test("test_connection_up_reads_the_adapter_state_at_collection_time", async () => {
    const harness = new MetricsHarness();
    let up = false;
    new PlatformConnectionMetrics(harness.meter, "twitch", () => up);

    const down = await harness.metric("woofx3.platform.connection.up");
    expect(down.unit).toBe("1");
    expect(down.points.map((point) => [point.attributes, point.value])).toEqual([[{ platform: "twitch" }, 0]]);

    up = true;
    const now = await harness.metric("woofx3.platform.connection.up");
    expect(now.points.map((point) => point.value)).toEqual([1]);
  });

  test("test_the_first_connection_is_not_a_reconnect", async () => {
    const harness = new MetricsHarness();
    const metrics = new PlatformConnectionMetrics(harness.meter, "twitch", () => true);
    metrics.connected();

    expect(harness.metric("woofx3.platform.reconnects")).rejects.toThrow("no metric named");
  });

  test("test_every_connection_after_the_first_counts_as_a_reconnect", async () => {
    const harness = new MetricsHarness();
    const metrics = new PlatformConnectionMetrics(harness.meter, "twitch", () => true);
    metrics.connected();
    metrics.connected();
    metrics.connected();

    const reconnects = await harness.metric("woofx3.platform.reconnects");
    expect(reconnects.unit).toBe("{reconnect}");
    expect(reconnects.points.map((point) => [point.attributes, point.value])).toEqual([[{ platform: "twitch" }, 2]]);
  });
});
