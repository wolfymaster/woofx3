import { describe, expect, test } from "bun:test";
import { MetricsHarness } from "@woofx3/common/logging/metrics-testing";
import { FakeTime } from "../../../host/testing";
import { EventMetrics } from "./eventMetrics";

const NOW_MS = Date.UTC(2026, 10, 26, 12, 0, 0);

function setup() {
  const harness = new MetricsHarness();
  const clock = new FakeTime(NOW_MS);
  return { clock, harness, metrics: new EventMetrics(harness.meter, clock) };
}

describe("EventMetrics", () => {
  test("test_record_counts_each_event_by_type_and_platform", async () => {
    const { harness, metrics } = setup();
    metrics.record("twitch", "twitch.cheer");
    metrics.record("twitch", "twitch.cheer");
    metrics.record("twitch", "twitch.follow");

    const received = await harness.metric("woofx3.events.received");
    expect(received.unit).toBe("{event}");
    const byType = Object.fromEntries(
      received.points.map((point) => [point.attributes["event.type"], [point.attributes.platform, point.value]])
    );
    expect(byType).toEqual({ "twitch.cheer": ["twitch", 2], "twitch.follow": ["twitch", 1] });
  });

  test("test_record_reports_when_the_last_event_arrived_per_platform", async () => {
    const { clock, harness, metrics } = setup();
    metrics.record("twitch", "twitch.cheer");
    await clock.advance(5_000);
    metrics.record("twitch", "twitch.follow");

    const last = await harness.metric("woofx3.events.last_received_time");
    expect(last.unit).toBe("s");
    expect(last.points.map((point) => [point.attributes, point.value])).toEqual([
      [{ platform: "twitch" }, (NOW_MS + 5_000) / 1000],
    ]);
  });

  test("test_record_measures_ingest_lag_from_the_platform_timestamp", async () => {
    const { harness, metrics } = setup();
    metrics.record("twitch", "twitch.follow", new Date(NOW_MS - 2_500));

    const lag = await harness.metric("woofx3.event.ingest.lag");
    expect(lag.unit).toBe("s");
    expect(lag.points).toHaveLength(1);
    expect(lag.points[0]?.attributes).toEqual({ platform: "twitch" });
    expect(lag.points[0]?.value).toMatchObject({ count: 1, sum: 2.5 });
  });

  test("test_record_without_a_platform_timestamp_records_no_lag", async () => {
    const { harness, metrics } = setup();
    metrics.record("twitch", "twitch.cheer");

    expect(harness.metric("woofx3.event.ingest.lag")).rejects.toThrow("no metric named");
  });

  test("test_record_clamps_a_timestamp_in_the_future_to_zero_lag", async () => {
    const { harness, metrics } = setup();
    metrics.record("twitch", "twitch.follow", new Date(NOW_MS + 1_000));

    const lag = await harness.metric("woofx3.event.ingest.lag");
    expect(lag.points[0]?.value).toMatchObject({ count: 1, sum: 0 });
  });
});
