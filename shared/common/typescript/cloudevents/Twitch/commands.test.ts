import { describe, expect, it } from "bun:test";
import { parseShoutoutEnqueueReply, type ShoutoutEnqueueReply } from "./commands";
import type { ParseResult } from "../utils";

describe("parseShoutoutEnqueueReply", () => {
  const cases: [name: string, body: unknown, expected: ParseResult<ShoutoutEnqueueReply>][] = [
    [
      "a queued reply",
      { queued: { position: 2, alreadyQueued: true } },
      { ok: true, value: { queued: { position: 2, alreadyQueued: true } } },
    ],
    [
      "a queued reply without alreadyQueued",
      { queued: { position: 1 } },
      { ok: true, value: { queued: { position: 1, alreadyQueued: false } } },
    ],
    ["an unavailable reply", { unavailable: "no dashboard" }, { ok: true, value: { unavailable: "no dashboard" } }],
    ["an error reply", { error: "HTTP 500" }, { ok: true, value: { error: "HTTP 500" } }],
    ["a queued reply without a position", { queued: {} }, { ok: false, error: "is malformed" }],
    ["an empty object", {}, { ok: false, error: "is malformed" }],
    ["an array", [], { ok: false, error: "is not an object" }],
    ["null", null, { ok: false, error: "is not an object" }],
  ];
  for (const [name, body, expected] of cases) {
    it(`reads ${name}`, () => {
      expect(parseShoutoutEnqueueReply(body)).toEqual(expected);
    });
  }
});
