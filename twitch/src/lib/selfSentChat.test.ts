import { describe, expect, test } from "bun:test";
import { normalizeChatLine, SelfSentRegistry } from "./selfSentChat";

const BROADCASTER = "broadcaster-1";
const CHATTER = "chatter-9";
const CONFIG = { capacity: 3, ttlMs: 1_000 };

function registryAt(start = 0) {
  const clock = { now: start };
  const registry = new SelfSentRegistry(CONFIG, () => clock.now);
  return { registry, clock };
}

function echo(messageId: string, text: string, chatterId = BROADCASTER) {
  return { messageId, chatterId, text };
}

describe("normalizeChatLine", () => {
  const cases: [string, string, string][] = [
    ["plain text", "hello", "hello"],
    ["surrounding whitespace", "  hello  ", "hello"],
    ["inner runs of whitespace", "hello   there\tyou", "hello there you"],
    ["the command guard", "​!title", "!title"],
  ];
  for (const [name, text, expected] of cases) {
    test(name, () => {
      expect(normalizeChatLine(text)).toBe(expected);
    });
  }
});

describe("SelfSentRegistry", () => {
  test("claims the echo of a sent line by its id, from any account", () => {
    const { registry } = registryAt();
    registry.begin("hello").sent("m-1");

    expect(registry.claimEcho(echo("m-1", "something else", CHATTER), BROADCASTER)).toBe(true);
  });

  test("claims an echo that beats Twitch's answer by text, from the broadcaster only", () => {
    const { registry } = registryAt();
    registry.begin("​!title new title");

    expect(registry.claimEcho(echo("m-1", "!title new title", CHATTER), BROADCASTER)).toBe(false);
    expect(registry.claimEcho(echo("m-1", "!title  new title"), BROADCASTER)).toBe(true);
  });

  test("claims one echo per sent line, so the streamer typing it again is read", () => {
    const { registry } = registryAt();
    const pending = registry.begin("gg");

    expect(registry.claimEcho(echo("m-1", "gg"), BROADCASTER)).toBe(true);
    pending.sent("m-1");
    expect(registry.claimEcho(echo("m-1", "gg"), BROADCASTER)).toBe(false);
    expect(registry.claimEcho(echo("m-2", "gg"), BROADCASTER)).toBe(false);
  });

  test("matches a line Twitch answered by its id only, not by text", () => {
    const { registry } = registryAt();
    registry.begin("gg").sent("m-1");

    expect(registry.claimEcho(echo("m-2", "gg"), BROADCASTER)).toBe(false);
    expect(registry.claimEcho(echo("m-1", "gg"), BROADCASTER)).toBe(true);
  });

  test("forgets a line Twitch did not say", () => {
    const { registry } = registryAt();
    registry.begin("gg").failed();

    expect(registry.claimEcho(echo("m-1", "gg"), BROADCASTER)).toBe(false);
  });

  test("forgets a line once its ttl has passed", () => {
    const { registry, clock } = registryAt();
    registry.begin("gg").sent("m-1");
    registry.begin("hi");

    clock.now = CONFIG.ttlMs;
    expect(registry.claimEcho(echo("m-1", "gg"), BROADCASTER)).toBe(false);
    expect(registry.claimEcho(echo("m-2", "hi"), BROADCASTER)).toBe(false);
  });

  test("holds at most capacity lines, forgetting the oldest", () => {
    const { registry } = registryAt();
    for (const line of ["one", "two", "three", "four"]) {
      registry.begin(line);
    }

    expect(registry.claimEcho(echo("m-1", "one"), BROADCASTER)).toBe(false);
    expect(registry.claimEcho(echo("m-4", "four"), BROADCASTER)).toBe(true);
  });

  test("ignores Twitch's answer for a line already forgotten", () => {
    const { registry } = registryAt();
    const pending = registry.begin("one");
    for (const line of ["two", "three", "four"]) {
      registry.begin(line);
    }

    pending.sent("m-1");
    expect(registry.claimEcho(echo("m-1", "one", CHATTER), BROADCASTER)).toBe(false);
  });

  test("refuses a sent line without an id", () => {
    const { registry } = registryAt();
    expect(() => registry.begin("gg").sent("")).toThrow("needs Twitch's message id");
  });

  test("refuses a capacity or ttl that cannot bound it", () => {
    for (const config of [
      { capacity: 0, ttlMs: 1 },
      { capacity: 1.5, ttlMs: 1 },
      { capacity: 1, ttlMs: 0 },
      { capacity: 1, ttlMs: Number.NaN },
    ]) {
      expect(() => new SelfSentRegistry(config, () => 0)).toThrow("SelfSentRegistry");
    }
  });
});
