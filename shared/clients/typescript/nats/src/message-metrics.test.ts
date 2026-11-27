import { describe, expect, test } from "bun:test";
import type { Msg as NatsCoreMsg } from "@nats-io/nats-core";
import { MetricsHarness } from "@woofx3/common/logging/metrics-testing";
import { consumeMessages } from "./client";
import { MessageProcessMetrics } from "./message-metrics";

const logger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

async function* messages(...subjects: string[]): AsyncIterable<NatsCoreMsg> {
  for (const subject of subjects) {
    yield { subject, data: new Uint8Array() } as unknown as NatsCoreMsg;
  }
}

/** Each read moves 100 ms on, so a handler call that reads twice lasts 100 ms. */
function steppingClock(): () => number {
  let now = 0;
  return () => {
    const read = now;
    now += 100;
    return read;
  };
}

async function recorded(harness: MetricsHarness) {
  const metric = await harness.metric("messaging.process.duration");
  return { unit: metric.unit, points: metric.points.map((p) => ({ attributes: p.attributes, value: p.value })) };
}

describe("messaging.process.duration", () => {
  test("test_a_handler_is_timed_under_the_subscription_pattern_not_the_message_subject", async () => {
    const harness = new MetricsHarness();
    const metrics = new MessageProcessMetrics(harness.meter, steppingClock());

    await consumeMessages("alerts.>", messages("alerts.a", "alerts.b"), () => {}, logger, metrics);
    await Bun.sleep(0);

    const { unit, points } = await recorded(harness);
    expect(unit).toBe("s");
    expect(points).toHaveLength(1);
    expect(points[0]?.attributes).toEqual({
      "messaging.system": "nats",
      "messaging.destination.name": "alerts.>",
    });
    expect(points[0]?.value).toMatchObject({ count: 2 });
  });

  test("test_a_handler_that_rejects_is_recorded_with_its_error_type_and_still_logged", async () => {
    const harness = new MetricsHarness();
    const metrics = new MessageProcessMetrics(harness.meter, steppingClock());
    const errors: string[] = [];

    await consumeMessages(
      "alerts.>",
      messages("alerts.a"),
      async () => {
        throw new RangeError("bad payload");
      },
      { ...logger, error: (text: string) => void errors.push(text) },
      metrics
    );
    await Bun.sleep(0);

    expect((await recorded(harness)).points[0]?.attributes).toMatchObject({ "error.type": "RangeError" });
    expect(errors).toEqual(["subscription handler failed"]);
  });

  test("test_a_handler_that_throws_a_non_error_is_recorded_as_non_error", async () => {
    const harness = new MetricsHarness();
    const metrics = new MessageProcessMetrics(harness.meter, steppingClock());

    await consumeMessages(
      "a",
      messages("a"),
      () => {
        throw "oops";
      },
      logger,
      metrics
    );
    await Bun.sleep(0);

    expect((await recorded(harness)).points[0]?.attributes).toMatchObject({ "error.type": "non_error" });
  });
});
