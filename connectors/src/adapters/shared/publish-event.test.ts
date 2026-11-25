import { describe, expect, test } from "bun:test";
import { RecordingLogger } from "../../host/testing";
import { type PublishTarget, publishEvent } from "./publish-event";

const BUS_DOWN = new Error("the bus scope is closed");
const BUILD_REFUSED = new Error("the payload is not a plain object");

/** A target whose bus records every subject, or refuses every publish. */
function target(refuse: boolean): { target: PublishTarget; logger: RecordingLogger; published: string[] } {
  const logger = new RecordingLogger();
  const published: string[] = [];
  return {
    logger,
    published,
    target: {
      logger,
      messageBus: {
        publish: async (subject) => {
          if (refuse) {
            throw BUS_DOWN;
          }
          published.push(subject);
        },
      },
    },
  };
}

describe("publishEvent", () => {
  test("logs a refused publish with its subject instead of rejecting", async () => {
    const { target: refusing, logger } = target(true);

    await publishEvent(refusing, () => ["user.follow", new Uint8Array()]);

    expect(logger.at("error")).toEqual([
      expect.objectContaining({ metadata: { subject: "user.follow", err: BUS_DOWN.message } }),
    ]);
  });

  test("logs an event that fails to build instead of rejecting, and publishes nothing", async () => {
    const { target: accepting, logger, published } = target(false);

    await publishEvent(accepting, () => {
      throw BUILD_REFUSED;
    });

    expect(published).toEqual([]);
    expect(logger.at("error")).toEqual([expect.objectContaining({ metadata: { err: BUILD_REFUSED.message } })]);
  });
});
