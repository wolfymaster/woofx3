import { describe, expect, test } from "bun:test";
import { encodePlatformApiError, encodePlatformApiReply, platformApiResultType } from "./reply";

const DEPS = { clock: { now: () => Date.UTC(2026, 10, 25, 12, 0, 0) }, ids: { next: () => "id-1" } };

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe("platform api reply envelope", () => {
  const golden: [name: string, encode: () => Uint8Array, wire: string][] = [
    [
      "a twitchapi result",
      () => encodePlatformApiReply("twitchapi", platformApiResultType("twitchapi", "getUser"), { id: "1" }, DEPS),
      '{"id":"id-1","type":"twitchapi.getUser.result","source":"twitchapi","time":"2026-11-25T12:00:00.000Z","data":{"id":"1"}}',
    ],
    [
      "a coded twitchapi error",
      () => encodePlatformApiError("twitchapi", "no scope", "missing_scope", DEPS),
      '{"id":"id-1","type":"twitchapi.error","source":"twitchapi","time":"2026-11-25T12:00:00.000Z","data":{"error":"no scope","code":"missing_scope"}}',
    ],
    [
      "an uncoded twitchapi error",
      () => encodePlatformApiError("twitchapi", "boom", undefined, DEPS),
      '{"id":"id-1","type":"twitchapi.error","source":"twitchapi","time":"2026-11-25T12:00:00.000Z","data":{"error":"boom"}}',
    ],
  ];

  for (const [name, encode, wire] of golden) {
    test(`encodes ${name} byte for byte`, () => {
      expect(text(encode())).toBe(wire);
    });
  }
});
