import { describe, expect, test } from "bun:test";
import { PLATFORM_GATEWAY_REPLY_TYPES } from "@woofx3/api/platform-gateway";
import { bytes, RecordingLogger } from "../host/testing";
import { GatewayReplier } from "./replier";
import { chatLine } from "./testing";

type Answer = { ok: boolean } | "throw" | "garbage";

function replierAnswering(answers: Answer[]): GatewayReplier {
  return new GatewayReplier({
    bus: {
      request: async (subject) => {
        const answer = answers.shift();
        if (answer === undefined || answer === "throw") {
          throw new Error("no responders");
        }
        if (answer === "garbage") {
          return { subject, data: bytes("not json") };
        }
        const data = answer.ok
          ? { ok: true, results: { twitch: { status: "delivered", messageId: "m" } } }
          : { ok: false, error: { code: "unavailable", message: "off" }, results: {} };
        return { subject, data: bytes(JSON.stringify({ type: PLATFORM_GATEWAY_REPLY_TYPES.send, data })) };
      },
    },
    timeoutMs: 1_000,
    logger: new RecordingLogger(),
  });
}

describe("GatewayReplier counters", () => {
  test("counts a delivered reply apart from every way a reply fails", async () => {
    const replier = replierAnswering([{ ok: true }, { ok: false }, "throw", "garbage"]);
    for (let i = 0; i < 4; i++) {
      await replier.reply(chatLine(), "title", "hi");
    }
    expect(replier.snapshot()).toEqual({ delivered: 1, failed: 3 });
  });
});
