// The engine's built-in widgets (modules/woofx3/widgets), each one's own
// script run against the SDK's mock host and a minimal document: what they
// draw, and that an edit to their settings redraws them in place.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMockHost, type MockHostOptions } from "@woofx3/module-sdk/src/preview/widget-preview";

const WIDGETS = resolve(import.meta.dir, "../../../modules/woofx3/widgets");

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly style = {
    props: new Map<string, string>(),
    setProperty(k: string, v: string) {
      this.props.set(k, v);
    },
  };
  className = "";
  private text = "";
  constructor(text = "") {
    this.text = text;
  }
  get textContent(): string {
    return this.children.length > 0 ? this.children.map((c) => c.textContent).join("") : this.text;
  }
  set textContent(value: string) {
    this.text = value;
    this.children.length = 0;
  }
  appendChild(child: FakeNode): void {
    this.children.push(child);
  }
}

/**
 * Run a widget's script with `options` for its host; returns the drawn element and the host's controller.
 * `globals` stand in for the scripts its page loads before its own, such as the Lottie player.
 */
function run(widget: string, options: MockHostOptions, globals: Record<string, unknown> = {}) {
  const html = readFileSync(resolve(WIDGETS, widget, "index.html"), "utf8");
  const script = html.slice(html.lastIndexOf("<script>") + "<script>".length, html.lastIndexOf("</script>"));
  const el = new FakeNode();
  const document = {
    getElementById: (id: string) => (id === "text" ? el : null),
    createElement: () => new FakeNode(),
    createTextNode: (text: string) => new FakeNode(text),
  };
  const mock = createMockHost({ moduleId: "woofx3", ...options });
  const names = Object.keys(globals);
  new Function("window", "document", ...names, script)(
    { widgetHost: mock.host },
    document,
    ...names.map((n) => globals[n])
  );
  return { el, mock };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("built-in counter widget", () => {
  const counter = (value: number) => ({ value: { value }, settings: { initialValue: 0, goals: "10" } });

  it("draws the counter through its template, and redraws in place when the template changes", async () => {
    const { el, mock } = run("counter", {
      settings: { counter: "woofx3:counter:deaths", text: "Deaths: {value}/{goal}" },
      storage: { "resource:woofx3:counter:deaths": counter(7) },
    });
    await tick();
    expect(el.textContent).toBe("Deaths: 7/10");
    mock.setSettings({ counter: "woofx3:counter:deaths", text: "{value} deaths" });
    expect(el.textContent).toBe("7 deaths");
  });

  it("follows another counter when the setting names one", async () => {
    const { el, mock } = run("counter", {
      settings: { counter: "woofx3:counter:a", text: "{value}" },
      storage: { "resource:woofx3:counter:a": counter(1), "resource:woofx3:counter:b": counter(2) },
    });
    await tick();
    expect(el.textContent).toBe("1");
    mock.setSettings({ counter: "woofx3:counter:b", text: "{value}" });
    expect(el.textContent).toBe("");
    await tick();
    expect(el.textContent).toBe("2");
    mock.setStorage("resource:woofx3:counter:a", counter(5));
    expect(el.textContent).toBe("2");
  });
});

describe("built-in timer widget", () => {
  it("redraws in place when its template changes", async () => {
    const stopped = { value: { running: false, remainingMs: 65_000 }, settings: { duration: 300 }, readAt: 0 };
    const { el, mock } = run("timer", {
      settings: { timer: "woofx3:timer:t", text: "{time} left" },
      storage: { "resource:woofx3:timer:t": stopped },
    });
    await tick();
    expect(el.textContent).toBe("1:05 left");
    mock.setSettings({ timer: "woofx3:timer:t", text: "Ends in {time}" });
    expect(el.textContent).toBe("Ends in 1:05");
  });
});

describe("built-in text widget", () => {
  it("redraws its letters in place when the text changes on a scene", () => {
    const { el, mock } = run("text", { settings: { text: "hi there" } });
    expect(el.textContent).toBe("hi there");
    mock.setSettings({ text: "bye" });
    expect(el.textContent).toBe("bye");
  });

  it("leaves a change in an alert to a reload, since its duration is read once there", () => {
    const { el, mock } = run("text", { settings: { text: "hi" }, surface: "alert" });
    mock.setSettings({ text: "bye" });
    expect(el.textContent).toBe("hi");
  });
});

describe("built-in lottie widget", () => {
  // A stand-in for the Lottie player that keeps the player's frame
  // bookkeeping: `currentFrame` counts from `firstFrame`, which playing a
  // segment moves to the segment's lower end.
  class FakeAnimation {
    firstFrame = 0;
    currentFrame = 0;
    readonly calls: unknown[][] = [];
    constructor(readonly options: { autoplay: boolean; loop: boolean }) {}
    goToAndStop(frame: number, isFrame: boolean): void {
      this.calls.push(["goToAndStop", this.firstFrame + frame, isFrame]);
      this.currentFrame = frame;
    }
    playSegments(segment: [number, number], forceFlag: boolean): void {
      this.calls.push(["playSegments", segment, forceFlag]);
      const [from, to] = segment;
      // Taken as already played through, so the frame on screen is `to`.
      this.firstFrame = Math.min(from, to);
      this.currentFrame = to - this.firstFrame;
    }
    addEventListener(): void {}
  }

  const SRC = "/assets/user/res-1/lollipop.json";
  // 51 frames, 0 to 50: frame = eaten * 10 for a counter from 0 to 5.
  const ANIMATION = JSON.stringify({ v: "5.12.2", fr: 30, ip: 0, op: 51, w: 100, h: 100, layers: [] });
  const counter = (value: number) => ({ value: { value }, settings: { initialValue: 0 } });

  function runLottie(options: MockHostOptions) {
    const animations: FakeAnimation[] = [];
    const lottie = {
      loadAnimation(opts: { autoplay: boolean; loop: boolean }) {
        const animation = new FakeAnimation(opts);
        animations.push(animation);
        return animation;
      },
    };
    const { mock } = run("lottie", { assets: { [SRC]: ANIMATION }, ...options }, { lottie });
    return { animations, mock };
  }

  it("plays on its own on a scene when it follows no counter", async () => {
    const { animations } = runLottie({ settings: { src: SRC } });
    await tick();
    expect(animations).toHaveLength(1);
    expect(animations[0].options).toMatchObject({ autoplay: true, loop: true });
  });

  it("shows the counter's frame, then plays from the frame shown to each new one", async () => {
    const { animations, mock } = runLottie({
      settings: { src: SRC, counter: "woofx3:counter:eaten", counterFrom: 0, counterTo: 5 },
      storage: { "resource:woofx3:counter:eaten": counter(2) },
    });
    await tick();
    await tick();
    const [animation] = animations;
    expect(animation.options).toMatchObject({ autoplay: false, loop: false });
    expect(animation.calls).toEqual([["goToAndStop", 20, true]]);

    mock.setStorage("resource:woofx3:counter:eaten", counter(3));
    mock.setStorage("resource:woofx3:counter:eaten", counter(0));
    expect(animation.calls.slice(1)).toEqual([
      ["playSegments", [20, 30], true],
      ["playSegments", [30, 0], true],
    ]);
  });

  it("holds the ends beyond the counter's range, and runs backwards when the range does", async () => {
    const { animations, mock } = runLottie({
      settings: { src: SRC, counter: "woofx3:counter:eaten", counterFrom: 10, counterTo: 0 },
      storage: { "resource:woofx3:counter:eaten": counter(15) },
    });
    await tick();
    await tick();
    const [animation] = animations;
    expect(animation.calls).toEqual([["goToAndStop", 0, true]]);
    mock.setStorage("resource:woofx3:counter:eaten", counter(-3));
    expect(animation.calls[1]).toEqual(["playSegments", [0, 50], true]);
  });

  it("leaves the counter to scenes: in an alert it plays once per alert", async () => {
    const { animations } = runLottie({
      surface: "alert",
      settings: { src: SRC, counter: "woofx3:counter:eaten" },
      storage: { "resource:woofx3:counter:eaten": counter(2) },
    });
    await tick();
    expect(animations).toHaveLength(0);
  });
});
