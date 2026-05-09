import { describe, expect, test } from "bun:test";
import type { CloudEventLike } from "../types";
import { mediaWidget } from "./media-widget";

function event(data: Record<string, unknown>): CloudEventLike {
  return {
    id: "evt-1",
    type: "test.event",
    source: "test",
    data,
  };
}

// Test helper: default WidgetInput.id so tests don't repeat boilerplate.
function render(input: { parameters: Record<string, unknown>; event: CloudEventLike | null; id?: string }) {
  return mediaWidget.render({ id: input.id ?? "envelope-1", parameters: input.parameters, event: input.event });
}

describe("MediaWidget", () => {
  test("interpolates a path from event.data", () => {
    const out = render({
      parameters: { text: "{event.data.userName}" },
      event: event({ userName: "alice" }),
    });
    expect(out?.text).toBe("alice");
  });

  test("ternary pluralization (subscription / subscriptions)", () => {
    const tmpl = "gifted {event.data.amount} {event.data.amount > 1 ? 'subscriptions' : 'subscription'}";
    const single = render({
      parameters: { text: tmpl },
      event: event({ amount: 1 }),
    });
    expect(single?.text).toBe("gifted 1 subscription");
    const many = render({
      parameters: { text: tmpl },
      event: event({ amount: 5 }),
    });
    expect(many?.text).toBe("gifted 5 subscriptions");
  });

  test("ternary pluralization (bit / bits)", () => {
    const tmpl = "{event.data.amount} {event.data.amount > 1 ? 'bits' : 'bit'}";
    const one = render({
      parameters: { text: tmpl },
      event: event({ amount: 1 }),
    });
    expect(one?.text).toBe("1 bit");
    const hundred = render({
      parameters: { text: tmpl },
      event: event({ amount: 100 }),
    });
    expect(hundred?.text).toBe("100 bits");
  });

  test("legacy {primary} expands to span tags", () => {
    const out = render({
      parameters: { text: "{primary}alice{primary} cheered" },
      event: null,
    });
    expect(out?.text).toBe('<span style="color: #EC6758">alice</span> cheered');
  });

  test("{primary} interleaved with expressions resolves both", () => {
    const out = render({
      parameters: {
        text: "{primary}{event.data.userName}{primary} cheered {event.data.amount}",
      },
      event: event({ userName: "alice", amount: 100 }),
    });
    expect(out?.text).toBe('<span style="color: #EC6758">alice</span> cheered 100');
  });

  test("odd {primary} count emits opening tag and leaves trailing text unwrapped", () => {
    const out = render({
      parameters: { text: "{primary}alice cheered" },
      event: null,
    });
    expect(out?.text).toBe('<span style="color: #EC6758">alice cheered');
  });

  test("missing event field renders empty without throwing", () => {
    const out = render({
      parameters: { text: "hello {event.data.userName}" },
      event: event({}),
    });
    expect(out?.text).toBe("hello ");
  });

  test("null event renders event-dependent template gracefully", () => {
    const out = render({
      parameters: { text: "hello {event.data.userName}" },
      event: null,
    });
    expect(out?.text).toBe("hello ");
  });

  test("parameter passthrough (literal mediaUrl/audioUrl)", () => {
    const out = render({
      parameters: {
        text: "hi",
        mediaUrl: "https://example.com/clip.mp4",
        audioUrl: "https://example.com/clip.mp3",
        duration: 7,
      },
      event: null,
    });
    expect(out?.mediaUrl).toBe("https://example.com/clip.mp4");
    expect(out?.audioUrl).toBe("https://example.com/clip.mp3");
    expect(out?.duration).toBe(7);
  });

  test("mediaUrl can be an expression too", () => {
    const out = render({
      parameters: {
        text: "hi",
        mediaUrl: "{event.data.giftClipUrl}",
      },
      event: event({ giftClipUrl: "https://example.com/gift.mp4" }),
    });
    expect(out?.mediaUrl).toBe("https://example.com/gift.mp4");
  });

  test("returns null when nothing renderable", () => {
    const out = render({
      parameters: {},
      event: null,
    });
    expect(out).toBeNull();
  });

  test("mediaUrl array is preserved (multi-layer alert)", () => {
    const out = render({
      parameters: {
        mediaUrl: ["https://example.com/lottie.json", "https://example.com/confetti.gif"],
        audioUrl: "https://example.com/sound.mp3",
      },
      event: null,
    });
    expect(Array.isArray(out?.mediaUrl)).toBe(true);
    expect(out?.mediaUrl).toEqual(["https://example.com/lottie.json", "https://example.com/confetti.gif"]);
  });

  test("text array runs each element through resolver + legacy tags", () => {
    const out = render({
      parameters: {
        text: ["{primary}{event.data.name}{primary}", "scored {event.data.amount}"],
      },
      event: event({ name: "alice", amount: 5 }),
    });
    expect(out?.text).toEqual(['<span style="color: #EC6758">alice</span>', "scored 5"]);
  });

  test("options array passes through (paired with mediaUrl indices in AlertWrapper)", () => {
    const optsArr = [
      { view: { fullScreen: true } },
      { view: { fullScreen: false } },
    ];
    const out = render({
      parameters: {
        mediaUrl: ["a.gif", "b.gif"],
        options: optsArr,
      },
      event: null,
    });
    expect(out?.options).toEqual(optsArr);
  });

  test("renders when only mediaUrl is present (no text, no audio)", () => {
    const out = render({
      parameters: { mediaUrl: "https://example.com/clip.mp4" },
      event: null,
    });
    expect(out).not.toBeNull();
    expect(out?.mediaUrl).toBe("https://example.com/clip.mp4");
  });

  test("uses envelope id as the rendered id (stable across renders)", () => {
    const out = render({
      parameters: { text: "hi" },
      event: null,
      id: "envelope-xyz",
    });
    expect(out?.id).toBe("envelope-xyz");
  });

  test("parameters.id (when string) overrides the envelope id", () => {
    const out = render({
      parameters: { text: "hi", id: "param-override" },
      event: null,
      id: "envelope-xyz",
    });
    expect(out?.id).toBe("param-override");
  });

  test("duration is undefined when not specified (no synthetic default)", () => {
    // The widget intentionally passes `duration` through as `undefined`
    // so AlertAudio plays audio to its natural end and AlertMessage
    // mirrors that lifetime. A synthetic default (e.g. 5s) would
    // truncate any audio longer than the default — see
    // streamware/ui/src/components/AlertAudio.tsx for the contract.
    const out = render({
      parameters: { text: "hi" },
      event: null,
    });
    expect(out?.duration).toBeUndefined();
  });

  test("duration is preserved as a hard ceiling when explicitly set", () => {
    const out = render({
      parameters: { text: "hi", duration: 8 },
      event: null,
    });
    expect(out?.duration).toBe(8);
  });

  test("parameters with `event` key cannot shadow the engine event", () => {
    const out = render({
      parameters: {
        text: "{event.data.userName}",
        event: { data: { userName: "shadow-attempt" } },
      },
      event: event({ userName: "real" }),
    });
    expect(out?.text).toBe("real");
  });
});
