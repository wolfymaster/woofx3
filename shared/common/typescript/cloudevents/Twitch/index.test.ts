import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { clearCurrentSessionId, setCurrentSessionId } from "../session";
import TwitchEvents, { assertPlainPayload, type HypeTrainBegin } from "./index";

beforeEach(() => {
  setCurrentSessionId("session-1");
});

afterEach(() => {
  clearCurrentSessionId();
});

/** Shaped like an SDK event: data behind a getter, credentials in an own field. */
class SdkEvent {
  readonly _client = { clientSecret: "sdk-secret" };

  get level(): number {
    return 3;
  }
}

const HYPE_TRAIN: HypeTrainBegin = {
  id: "train-1",
  broadcasterId: "broadcaster-1",
  broadcasterName: "Wolfy",
  level: 3,
  total: 2000,
  progress: 100,
  goal: 2200,
  topContributions: [{ userId: "user-1", userName: "Pup", type: "bits", total: 1500 }],
  startedAt: "2026-10-21T18:00:00.000Z",
  expiresAt: "2026-10-21T18:05:00.000Z",
};

describe("TwitchEvents", () => {
  test("encodes a plain payload as the event's data", () => {
    const [topic, bytes] = new TwitchEvents("twitch").hypeTrainBegin(HYPE_TRAIN);
    const event = JSON.parse(new TextDecoder().decode(bytes));

    expect(topic).toBe("channel.hypetrain");
    expect(event.platform).toBe("twitch");
    expect(event.data).toEqual(HYPE_TRAIN);
  });

  test("refuses to encode a class instance", () => {
    const sdkEvent = new SdkEvent() as unknown as HypeTrainBegin;

    expect(() => new TwitchEvents("twitch").hypeTrainBegin(sdkEvent)).toThrow(
      "payload is an instance of SdkEvent; map it into a plain object before publishing"
    );
  });

  test("refuses a class instance nested in a plain payload", () => {
    const contribution = new SdkEvent() as unknown as HypeTrainBegin["topContributions"][number];

    expect(() =>
      new TwitchEvents("twitch").hypeTrainBegin({ ...HYPE_TRAIN, topContributions: [contribution] })
    ).toThrow("payload.topContributions[0] is an instance of SdkEvent");
  });
});

describe("assertPlainPayload", () => {
  const accepted: [string, unknown][] = [
    ["a plain object", { a: 1, b: "two", c: true, d: null, e: undefined }],
    ["a null-prototype object", Object.assign(Object.create(null), { a: 1 })],
    ["nested arrays and objects", { list: [{ a: [1, 2] }, []] }],
    [
      "the same object in two places",
      (() => {
        const shared = { a: 1 };
        return { left: shared, right: shared };
      })(),
    ],
  ];

  for (const [name, value] of accepted) {
    test(`accepts ${name}`, () => {
      expect(() => assertPlainPayload(value)).not.toThrow();
    });
  }

  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;

  const rejected: [string, unknown, string][] = [
    ["a Date", { at: new Date(0) }, "payload.at is an instance of Date"],
    ["a Map", { map: new Map() }, "payload.map is an instance of Map"],
    ["a function", { fn: () => 1 }, "payload.fn is a function"],
    ["a bigint", { big: 1n }, "payload.big is a bigint"],
    ["NaN", { n: Number.NaN }, "payload.n is NaN"],
    ["Infinity", { list: [Number.POSITIVE_INFINITY] }, "payload.list[0] is Infinity"],
    ["a cycle", cyclic, "payload.self refers back to one of its own ancestors"],
  ];

  for (const [name, value, message] of rejected) {
    test(`rejects ${name}`, () => {
      expect(() => assertPlainPayload(value)).toThrow(message);
    });
  }
});
