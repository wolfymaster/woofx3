import { describe, expect, test } from "bun:test";
import {
  type ContractResult,
  parseChatAnnounceRequest,
  parseChatSendRequest,
  platformChatSendSubject,
  TWITCH_CHAT_ANNOUNCE_SUBJECT,
  TWITCH_CHAT_SEND_SUBJECT,
} from "./chat";

describe("provider subjects", () => {
  test("sit under the engine-reserved platform namespace", () => {
    expect(TWITCH_CHAT_SEND_SUBJECT).toBe("platform.twitch.chat.send");
    expect(TWITCH_CHAT_ANNOUNCE_SUBJECT).toBe("platform.twitch.chat.announce");
    expect(platformChatSendSubject("youtube")).toBe("platform.youtube.chat.send");
  });
});

describe("parseChatSendRequest", () => {
  const cases: [string, unknown, ContractResult<unknown>][] = [
    ["a message", { message: "hi" }, { ok: true, value: { message: "hi" } }],
    [
      "a reply",
      { message: "hi", replyToMessageId: "m-1" },
      { ok: true, value: { message: "hi", replyToMessageId: "m-1" } },
    ],
    ["the message kept as given", { message: " hi " }, { ok: true, value: { message: " hi " } }],
    ["not an object", "hi", { ok: false, error: "request must be a JSON object" }],
    ["an array", [], { ok: false, error: "request must be a JSON object" }],
    ["null", null, { ok: false, error: "request must be a JSON object" }],
    ["no message", {}, { ok: false, error: "message must be a non-empty string" }],
    ["a blank message", { message: " \t" }, { ok: false, error: "message must be a non-empty string" }],
    ["a message that is not text", { message: 7 }, { ok: false, error: "message must be a non-empty string" }],
    [
      "a blank reply id",
      { message: "hi", replyToMessageId: "" },
      { ok: false, error: "replyToMessageId must be a non-empty string when given" },
    ],
    [
      "a reply id that is not text",
      { message: "hi", replyToMessageId: 1 },
      { ok: false, error: "replyToMessageId must be a non-empty string when given" },
    ],
    ["an unknown field", { message: "hi", color: "blue" }, { ok: false, error: 'unknown field "color"' }],
  ];
  for (const [name, body, expected] of cases) {
    test(name, () => {
      expect(parseChatSendRequest(body)).toEqual(expected);
    });
  }
});

describe("parseChatAnnounceRequest", () => {
  const cases: [string, unknown, ContractResult<unknown>][] = [
    ["a message", { message: "hi" }, { ok: true, value: { message: "hi" } }],
    ["a color", { message: "hi", color: "orange" }, { ok: true, value: { message: "hi", color: "orange" } }],
    [
      "a color Twitch lacks",
      { message: "hi", color: "red" },
      { ok: false, error: "color must be one of primary, blue, green, orange, purple" },
    ],
    [
      "a color in the wrong case",
      { message: "hi", color: "Blue" },
      { ok: false, error: "color must be one of primary, blue, green, orange, purple" },
    ],
    ["no message", { color: "blue" }, { ok: false, error: "message must be a non-empty string" }],
    [
      "a reply id",
      { message: "hi", replyToMessageId: "m-1" },
      { ok: false, error: 'unknown field "replyToMessageId"' },
    ],
    ["not an object", 3, { ok: false, error: "request must be a JSON object" }],
  ];
  for (const [name, body, expected] of cases) {
    test(name, () => {
      expect(parseChatAnnounceRequest(body)).toEqual(expected);
    });
  }
});
