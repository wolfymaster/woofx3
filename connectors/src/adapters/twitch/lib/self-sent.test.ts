import { describe, expect, test } from "bun:test";
import { FakeTime } from "../../../host/testing";
import { type ChatEcho, normalizeChatLine, type SelfSentConfig, SelfSentRegistry } from "./self-sent";

const CONFIG: SelfSentConfig = { capacity: 4, ttlMs: 30_000 };

function registry(config: SelfSentConfig = CONFIG): { lines: SelfSentRegistry; time: FakeTime } {
  const time = new FakeTime();
  return { lines: new SelfSentRegistry(config, time), time };
}

/** An echo from the broadcaster's account, which is how every engine line comes back. */
function echo(text: string, messageId = "echo-1"): ChatEcho {
  return { messageId, text, fromBroadcaster: true };
}

describe("normalizeChatLine", () => {
  const cases: Array<[name: string, text: string, normalized: string]> = [
    ["plain text", "hello there", "hello there"],
    ["the guard's zero-width space", "​!title", "!title"],
    ["surrounding whitespace", "  hi  ", "hi"],
    ["runs of whitespace", "a \t  b\nc", "a b c"],
  ];
  for (const [name, text, normalized] of cases) {
    test(`removes ${name}`, () => {
      expect(normalizeChatLine(text)).toBe(normalized);
    });
  }
});

describe("SelfSentRegistry", () => {
  test("claims a sent line's echo by its id and carries its workflow chain", () => {
    const { lines } = registry();
    lines.begin("hi chat", "wf-a,wf-b").sent("msg-1");

    expect(lines.claimEcho(echo("hi chat", "msg-1"))).toEqual({ workflowChain: "wf-a,wf-b" });
  });

  // The engine says "!hi" behind the guard; the streamer typing "!hi" while that is in flight is a different line.
  test("does not claim a bare command by text when the sent line was guarded", () => {
    const { lines } = registry();
    lines.begin("\u200b!hi");

    expect(lines.claimEcho(echo("!hi"))).toBeNull();
    expect(lines.claimEcho(echo("\u200b!hi"))).not.toBeNull();
  });

  test("claims a bare command by text when the sent line was not guarded", () => {
    const { lines } = registry();
    lines.begin("!hi");

    expect(lines.claimEcho(echo("!hi"))).not.toBeNull();
  });

  test("counting waiting lines does not forget the expired ones", async () => {
    const { lines, time } = registry();
    lines.begin("hi");
    await time.advance(CONFIG.ttlMs);

    expect(lines.size).toBe(0);
    expect(lines.claimEcho(echo("hi"))).toBeNull();
  });

  test("claims by id whoever the chatter appears to be", () => {
    const { lines } = registry();
    lines.begin("hi chat").sent("msg-1");

    expect(lines.claimEcho({ messageId: "msg-1", text: "hi chat", fromBroadcaster: false })).toEqual({
      workflowChain: undefined,
    });
  });

  // EventSub can deliver the echo before Helix answers the send.
  test("claims an echo that outran the reply by its text", () => {
    const { lines } = registry();
    const line = lines.begin("​!title is shown", "wf-a");

    expect(lines.claimEcho(echo("\u200b!title  is shown"))).toEqual({ workflowChain: "wf-a" });
    line.sent("echo-1");
    expect(lines.size).toBe(0);
  });

  test("never claims by text once the send has an id", () => {
    const { lines } = registry();
    lines.begin("same words").sent("msg-1");

    expect(lines.claimEcho(echo("same words", "typed-by-streamer"))).toBeNull();
    expect(lines.claimEcho(echo("same words", "msg-1"))).not.toBeNull();
  });

  test("never claims by text a line from anyone but the broadcaster", () => {
    const { lines } = registry();
    lines.begin("hi chat");

    expect(lines.claimEcho({ messageId: "viewer-1", text: "hi chat", fromBroadcaster: false })).toBeNull();
    expect(lines.size).toBe(1);
  });

  // The streamer typing the engine's words again afterwards is the streamer.
  test("answers for one echo only", () => {
    const { lines } = registry();
    lines.begin("gg");

    expect(lines.claimEcho(echo("gg", "echo-1"))).not.toBeNull();
    expect(lines.claimEcho(echo("gg", "echo-2"))).toBeNull();
  });

  test("claims identical pending lines oldest first, one each", () => {
    const { lines } = registry();
    lines.begin("gg", "first");
    lines.begin("gg", "second");

    expect(lines.claimEcho(echo("gg", "echo-1"))).toEqual({ workflowChain: "first" });
    expect(lines.claimEcho(echo("gg", "echo-2"))).toEqual({ workflowChain: "second" });
  });

  test("forgets a line Twitch refused or dropped", () => {
    const { lines } = registry();
    lines.begin("blocked term").failed();

    expect(lines.claimEcho(echo("blocked term"))).toBeNull();
    expect(lines.size).toBe(0);
  });

  test("forgets a line whose echo did not arrive within the ttl", async () => {
    const { lines, time } = registry();
    lines.begin("hi chat").sent("msg-1");

    await time.advance(CONFIG.ttlMs);

    expect(lines.claimEcho(echo("hi chat", "msg-1"))).toBeNull();
  });

  test("still claims just before the ttl", async () => {
    const { lines, time } = registry();
    lines.begin("hi chat");

    await time.advance(CONFIG.ttlMs - 1);

    expect(lines.claimEcho(echo("hi chat"))).not.toBeNull();
  });

  test("holds at most capacity lines, forgetting the oldest", () => {
    const { lines } = registry({ capacity: 2, ttlMs: CONFIG.ttlMs });
    lines.begin("one");
    lines.begin("two");
    lines.begin("three");

    expect(lines.size).toBe(2);
    expect(lines.claimEcho(echo("one"))).toBeNull();
    expect(lines.claimEcho(echo("three"))).not.toBeNull();
  });

  test("settling an evicted or claimed line changes nothing", () => {
    const { lines } = registry({ capacity: 1, ttlMs: CONFIG.ttlMs });
    const evicted = lines.begin("one");
    lines.begin("two");

    evicted.sent("msg-1");
    evicted.failed();

    expect(lines.claimEcho(echo("one", "msg-1"))).toBeNull();
    expect(lines.size).toBe(1);
  });

  test("records nothing for a line that is only whitespace", () => {
    const { lines } = registry();
    lines.begin(" ​ ").sent("msg-1");

    expect(lines.size).toBe(0);
  });

  const invalid: Array<[name: string, config: SelfSentConfig]> = [
    ["a zero capacity", { capacity: 0, ttlMs: 1 }],
    ["a fractional capacity", { capacity: 1.5, ttlMs: 1 }],
    ["a zero ttl", { capacity: 1, ttlMs: 0 }],
    ["an infinite ttl", { capacity: 1, ttlMs: Number.POSITIVE_INFINITY }],
  ];
  for (const [name, config] of invalid) {
    test(`refuses ${name}`, () => {
      expect(() => new SelfSentRegistry(config, new FakeTime())).toThrow("SelfSentRegistry");
    });
  }
});
