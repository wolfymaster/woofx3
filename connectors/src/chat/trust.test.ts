import { describe, expect, test } from "bun:test";
import { BROADCASTER, MODERATOR, NO_ROLES } from "./testing";
import { readChatLine, TRUSTED_LINE_SOURCES } from "./trust";

function envelope(
  overrides: Record<string, unknown> = {},
  data: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: "evt-1",
    type: "user.message",
    source: TRUSTED_LINE_SOURCES.twitch,
    platform: "twitch",
    ...overrides,
    data: {
      messageId: "m-1",
      chatterId: "v-1",
      chatterName: "Viewer",
      chatterLogin: "viewer",
      channelId: null,
      message: "!hug",
      membership: MODERATOR,
      fromEngine: false,
      ...data,
    },
  };
}

describe("readChatLine", () => {
  const refusals: Array<{ name: string; value: unknown; problem: string }> = [
    { name: "not an object", value: "nope", problem: "not an object" },
    { name: "no platform", value: envelope({ platform: undefined }), problem: "no known platform" },
    { name: "an unknown platform", value: envelope({ platform: "myspace" }), problem: "no known platform" },
    { name: "no data", value: { ...envelope(), data: null }, problem: "no data object" },
    { name: "no speaker id", value: envelope({}, { chatterId: undefined }), problem: "no speaker id" },
    { name: "a blank speaker id", value: envelope({}, { chatterId: "  " }), problem: "no speaker id" },
    { name: "no text", value: envelope({}, { message: 42 }), problem: "no message text" },
    {
      name: "no message id and no event id",
      value: envelope({ id: undefined }, { messageId: undefined }),
      problem: "no message id",
    },
  ];
  for (const { name, value, problem } of refusals) {
    test(`refuses a line with ${name}`, () => {
      const reading = readChatLine(value);
      expect(reading.kind).toBe("refused");
      expect(reading.kind === "refused" && reading.problem).toContain(problem);
    });
  }

  test("drops a line the engine said itself, before anything else is read", () => {
    expect(readChatLine(envelope({}, { fromEngine: true, chatterId: undefined }))).toEqual({ kind: "from_engine" });
  });

  test("a line from the platform's own adapter is trusted, with its membership and message id", () => {
    const reading = readChatLine(envelope());
    expect(reading).toEqual({
      kind: "line",
      line: {
        platform: "twitch",
        viewer: { platform: "twitch", platformUserId: "v-1" },
        chatterLogin: "viewer",
        chatterName: "Viewer",
        text: "!hug",
        messageId: "m-1",
        lineId: "m-1",
        trusted: true,
        membership: MODERATOR,
        sharedChat: false,
      },
    });
  });

  test("a line from any other source is untrusted: no membership, no platform message id", () => {
    const reading = readChatLine(envelope({ source: "api" }, { membership: BROADCASTER }));
    if (reading.kind !== "line") {
      throw new Error(`expected a line, got ${reading.kind}`);
    }
    expect(reading.line.trusted).toBe(false);
    expect(reading.line.membership).toBeUndefined();
    expect(reading.line.messageId).toBeUndefined();
    expect(reading.line.lineId).toBe("evt-1");
  });

  test("a shared-chat line never carries broadcaster or moderator", () => {
    const reading = readChatLine(
      envelope({}, { channelId: "partner-1", membership: { ...BROADCASTER, isModerator: true, isVip: true } })
    );
    if (reading.kind !== "line") {
      throw new Error(`expected a line, got ${reading.kind}`);
    }
    expect(reading.line.sharedChat).toBe(true);
    expect(reading.line.membership).toEqual({ ...NO_ROLES, isVip: true });
  });

  test("membership with a non-boolean flag is unknown, not guessed", () => {
    const reading = readChatLine(envelope({}, { membership: { ...MODERATOR, isVip: "yes" } }));
    expect(reading.kind === "line" && reading.line.membership).toBeUndefined();
  });

  test("the optional membership fields carry through", () => {
    const membership = { ...NO_ROLES, isSubscriber: true, isFollower: false, subscriberTier: "tier2" };
    const reading = readChatLine(envelope({}, { membership }));
    expect(reading.kind === "line" && reading.line.membership).toEqual(membership);
  });

  test("without a login, the display name stands in, lowercased", () => {
    const reading = readChatLine(envelope({}, { chatterLogin: undefined, chatterName: "WolfyMaster" }));
    expect(reading.kind === "line" && reading.line.chatterLogin).toBe("wolfymaster");
  });
});
