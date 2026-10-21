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

/** Run a widget's script with `options` for its host; returns the drawn element and the host's controller. */
function run(widget: string, options: MockHostOptions) {
  const html = readFileSync(resolve(WIDGETS, widget, "index.html"), "utf8");
  const script = html.slice(html.lastIndexOf("<script>") + "<script>".length, html.lastIndexOf("</script>"));
  const el = new FakeNode();
  const document = {
    getElementById: (id: string) => (id === "text" ? el : null),
    createElement: () => new FakeNode(),
    createTextNode: (text: string) => new FakeNode(text),
  };
  const mock = createMockHost({ moduleId: "woofx3", ...options });
  new Function("window", "document", script)({ widgetHost: mock.host }, document);
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
