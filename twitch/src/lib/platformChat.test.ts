import { describe, expect, mock, test } from "bun:test";
import {
  type ChatSendReply,
  TWITCH_CHAT_ANNOUNCE_SUBJECT,
  TWITCH_CHAT_SEND_SUBJECT,
} from "@woofx3/common/cloudevents/Platform/chat";
import type { HelixCommandArgs, HelixCommandResult } from "@woofx3/common/cloudevents/Twitch/commands";
import { answerChatRequest, chatReplyOf } from "./platformChat";
import { TwitchApiError } from "./twitchApiError";

const SENT: HelixCommandResult = {
  ok: true,
  body: { data: [{ message_id: "m-1", is_sent: true, drop_reason: null }] },
};

function helixAnswering(result: HelixCommandResult | Error) {
  return mock(async (_args: HelixCommandArgs): Promise<HelixCommandResult> => {
    if (result instanceof Error) {
      throw result;
    }
    return result;
  });
}

describe("answerChatRequest", () => {
  test("says a line through Send Chat Message, as a reply when asked", async () => {
    const helix = helixAnswering(SENT);

    const reply = await answerChatRequest(
      TWITCH_CHAT_SEND_SUBJECT,
      { message: "hi", replyToMessageId: "parent-1" },
      helix
    );

    expect(reply).toEqual({ ok: true, isSent: true, messageId: "m-1" });
    expect(helix.mock.calls[0]?.[0]).toEqual({
      operation: "sendChatMessage",
      params: { message: "hi", reply_parent_message_id: "parent-1" },
    });
  });

  test("says an announcement through Send Chat Announcement", async () => {
    const helix = helixAnswering({ ok: true, body: null });

    const reply = await answerChatRequest(TWITCH_CHAT_ANNOUNCE_SUBJECT, { message: "news", color: "purple" }, helix);

    expect(reply).toEqual({ ok: true, isSent: true });
    expect(helix.mock.calls[0]?.[0]).toEqual({
      operation: "sendChatAnnouncement",
      params: { message: "news", color: "purple" },
    });
  });

  const refusals: [string, string, unknown, string][] = [
    ["a body that is not an object", TWITCH_CHAT_SEND_SUBJECT, undefined, "request must be a JSON object"],
    ["an empty message", TWITCH_CHAT_SEND_SUBJECT, { message: "  " }, "message must be a non-empty string"],
    ["an unknown field", TWITCH_CHAT_SEND_SUBJECT, { message: "hi", pin: true }, 'unknown field "pin"'],
    ["a color Twitch lacks", TWITCH_CHAT_ANNOUNCE_SUBJECT, { message: "hi", color: "red" }, "color must be one of"],
    ["a subject it does not serve", "platform.twitch.chat.whisper", { message: "hi" }, "not a Twitch chat provider"],
  ];
  for (const [name, subject, body, reason] of refusals) {
    test(`refuses ${name} as invalid without asking Twitch`, async () => {
      const helix = helixAnswering(SENT);

      const reply = await answerChatRequest(subject, body, helix);

      expect(reply.ok).toBe(false);
      if (!reply.ok) {
        expect(reply.error.code).toBe("invalid");
        expect(reply.error.message).toContain(reason);
      }
      expect(helix).not.toHaveBeenCalled();
    });
  }

  test("answers not_linked while no Twitch account is linked", async () => {
    const reply = await answerChatRequest(TWITCH_CHAT_SEND_SUBJECT, { message: "hi" }, undefined);

    expect(reply).toEqual({
      ok: false,
      error: { code: "not_linked", message: "Twitch is not linked yet: the streamer has to connect Twitch first" },
    });
  });

  test("answers a refusal before sending as invalid, and any other failure as upstream", async () => {
    const refused = await answerChatRequest(
      TWITCH_CHAT_SEND_SUBJECT,
      { message: "hi" },
      helixAnswering(new TwitchApiError("invalid_arguments", "helix sendChatMessage: bad"))
    );
    const timedOut = await answerChatRequest(
      TWITCH_CHAT_SEND_SUBJECT,
      { message: "hi" },
      helixAnswering(new Error("helix sendChatMessage: no answer within 8s; Twitch may still have acted"))
    );

    expect(refused).toEqual({ ok: false, error: { code: "invalid", message: "helix sendChatMessage: bad" } });
    expect(timedOut).toEqual({
      ok: false,
      error: { code: "upstream", message: "helix sendChatMessage: no answer within 8s; Twitch may still have acted" },
    });
  });
});

describe("chatReplyOf", () => {
  const cases: [string, HelixCommandResult, ChatSendReply][] = [
    ["a sent line", SENT, { ok: true, isSent: true, messageId: "m-1" }],
    [
      "a line Twitch dropped",
      {
        ok: true,
        body: { data: [{ message_id: "", is_sent: false, drop_reason: { code: "x", message: "AutoMod held it" } }] },
      },
      { ok: true, isSent: false, dropReason: "AutoMod held it" },
    ],
    ["an announcement (204)", { ok: true, body: null }, { ok: true, isSent: true }],
    [
      "a body that is not a sent message",
      { ok: true, body: { data: [] } },
      {
        ok: false,
        error: { code: "upstream", message: "Twitch answered with a body that is not a sent chat message" },
      },
    ],
    [
      "a malformed line",
      { ok: false, status: 400, body: '{"error":"Bad Request","status":400,"message":"message is too long"}' },
      { ok: false, error: { code: "invalid", message: "Twitch refused the line (HTTP 400): message is too long" } },
    ],
    [
      "a reply to an unknown message",
      { ok: false, status: 422, body: '{"message":"parent message not found"}' },
      {
        ok: false,
        error: { code: "invalid", message: "Twitch refused the line (HTTP 422): parent message not found" },
      },
    ],
    [
      "a rate limit",
      { ok: false, status: 429, body: "" },
      { ok: false, error: { code: "rate_limited", message: "Twitch refused the line (HTTP 429): " } },
    ],
    [
      "a forbidden sender",
      { ok: false, status: 403, body: "not json" },
      { ok: false, error: { code: "upstream", message: "Twitch refused the line (HTTP 403): not json" } },
    ],
  ];
  for (const [name, result, expected] of cases) {
    test(name, () => {
      expect(chatReplyOf(result)).toEqual(expected);
    });
  }
});
