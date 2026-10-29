import { describe, expect, test } from "bun:test";
import { NoRespondersError, RequestError, TimeoutError } from "@woofx3/nats";
import { bytes, text } from "../host/testing";
import { failureReply, TwitchApiClient, type TwitchApiFailure } from "./twitchapi-client";

type Request = (
  subject: string,
  data: Uint8Array,
  opts: { timeout: number }
) => Promise<{ subject: string; data: Uint8Array }>;

function clientAnswering(request: Request, timeoutMs = 10_000): TwitchApiClient {
  return new TwitchApiClient({ bus: { request }, timeoutMs });
}

function answer(type: string, data: unknown): Request {
  return async (subject) => ({ subject, data: bytes(JSON.stringify({ id: "r", type, source: "twitchapi", data })) });
}

function failing(error: Error): Request {
  return async () => {
    throw error;
  };
}

describe("TwitchApiClient", () => {
  test("sends the command on the twitchapi subject with the configured timeout", async () => {
    const seen: Array<{ subject: string; body: unknown; timeout: number }> = [];
    const client = clientAnswering(async (subject, data, opts) => {
      seen.push({ subject, body: JSON.parse(text(data)), timeout: opts.timeout });
      return answer("twitchapi.timeout.result", { ok: true })(subject, data, opts);
    }, 4_000);
    const result = await client.timeout({ userId: "7", durationSeconds: 30 });
    expect(result).toEqual({ ok: true, value: null });
    expect(seen).toEqual([
      {
        subject: "twitchapi",
        body: { command: "timeout", args: { userId: "7", durationSeconds: 30 } },
        timeout: 4_000,
      },
    ]);
  });

  test("reads an updateStream result", async () => {
    const client = clientAnswering(
      answer("twitchapi.updateStream.result", { ok: true, categoryName: "Chess", tags: [] })
    );
    expect(await client.updateStream({ category: "chess" })).toEqual({ ok: true, value: { categoryName: "Chess" } });
  });

  test("reads a marker result", async () => {
    const client = clientAnswering(answer("twitchapi.createMarker.result", { positionSeconds: 3725, id: "m" }));
    expect(await client.createMarker({})).toEqual({ ok: true, value: { positionSeconds: 3725 } });
  });

  const failures: Array<[name: string, request: Request, expected: TwitchApiFailure]> = [
    ["a timeout", failing(new TimeoutError()), { kind: "no_answer" }],
    [
      "no responders",
      failing(new RequestError("no responders", { cause: new NoRespondersError("twitchapi") })),
      { kind: "unreachable" },
    ],
    ["a bare no responders", failing(new NoRespondersError("twitchapi")), { kind: "unreachable" }],
    [
      "an error whose message only mentions no responders",
      failing(new Error("no responders 503")),
      { kind: "failed", message: "no responders 503" },
    ],
    ["another bus error", failing(new Error("connection closed")), { kind: "failed", message: "connection closed" }],
    [
      "a coded refusal",
      answer("twitchapi.error", { error: "needs scope", code: "missing_scope" }),
      { kind: "refused", message: "needs scope", code: "missing_scope" },
    ],
    [
      "an unknown refusal code",
      answer("twitchapi.error", { error: "odd", code: "brand_new" }),
      { kind: "refused", message: "odd", code: undefined },
    ],
    [
      "a refusal without an error",
      answer("twitchapi.error", { code: "unauthorized" }),
      { kind: "failed", message: "the Twitch adapter refused the request" },
    ],
    [
      "a result of the wrong shape",
      answer("twitchapi.createMarker.result", { positionSeconds: "soon" }),
      { kind: "failed", message: "the Twitch adapter sent a reply of an unexpected shape" },
    ],
    [
      "a result of another command",
      answer("twitchapi.updateStream.result", { title: "x" }),
      {
        kind: "failed",
        message: "the Twitch adapter sent a reply of an unexpected type (twitchapi.updateStream.result)",
      },
    ],
    [
      "a reply that is not JSON",
      async (subject) => ({ subject, data: bytes("nope") }),
      { kind: "failed", message: "the Twitch adapter sent a reply that is not JSON" },
    ],
  ];

  test.each(failures)("maps %s to a failure", async (_name, request, expected) => {
    expect(await clientAnswering(request).createMarker({})).toEqual({ ok: false, failure: expected });
  });

  test("refuses a timeout that is not a positive whole number", () => {
    expect(() => clientAnswering(answer("x", {}), 0)).toThrow("positive whole number");
  });
});

describe("failureReply", () => {
  const cases: Array<[name: string, failure: TwitchApiFailure, reply: string]> = [
    [
      "no answer",
      { kind: "no_answer" },
      "No answer from Twitch yet, so it is unknown whether I could do it; it may still apply",
    ],
    ["unreachable", { kind: "unreachable" }, "Could not do it: Twitch is not reachable right now"],
    [
      "integration unavailable",
      { kind: "refused", message: "adapter stopped", code: "integration_unavailable" },
      "Twitch is not available right now, so I could not do it",
    ],
    [
      "not linked",
      { kind: "refused", message: "no token", code: "not_linked" },
      "Twitch is not linked yet, so I could not do it",
    ],
    [
      "other refusal",
      { kind: "refused", message: "needs scope", code: "missing_scope" },
      "Could not do it: needs scope",
    ],
    ["failed", { kind: "failed", message: "boom" }, "Could not do it: boom"],
  ];
  test.each(cases)("%s", (_name, failure, reply) => {
    expect(failureReply("do it", failure)).toBe(reply);
  });
});
