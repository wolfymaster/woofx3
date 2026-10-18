import { describe, expect, it } from "bun:test";
import { DraftPreview } from "../../public/scene-manager/draft-preview";
import { PREVIEW_LAYOUT_MESSAGE } from "../../public/scene-manager/preview-layout";

function harness() {
  const updates: number[] = [];
  const shown: unknown[][] = [];
  const timers = new Map<number, () => void>();
  let id = 0;
  const preview = new DraftPreview({
    isAlertArea: (pid) => pid === "alert",
    onLayout: () => {},
    onPlacements: (placements) => shown.push([...placements]),
    requestUpdate: () => updates.push(1),
    timers: {
      setTimeout: (fn) => {
        id += 1;
        timers.set(id, fn);
        return id;
      },
      clearTimeout: (handle) => {
        timers.delete(handle as number);
      },
    },
  });
  const settle = () => {
    for (const [key, fn] of [...timers]) {
      timers.delete(key);
      fn();
    }
  };
  const send = (placements: unknown[]) => preview.handleMessage({ type: PREVIEW_LAYOUT_MESSAGE, placements });
  return { preview, updates, shown, timers, settle, send };
}

const text = (settings: Record<string, unknown>) => ({ id: "a", widgetCanonicalId: "w:text", settings });

describe("DraftPreview", () => {
  it("hands every message's placements on, and asks the server once per widget or theme change", () => {
    const h = harness();
    h.send([text({ text: "h" })]);
    h.send([text({ text: "hi" })]);
    h.settle();
    expect(h.shown).toHaveLength(2);
    expect(h.updates).toHaveLength(1);
    h.send([text({ text: "hi there" })]);
    h.settle();
    expect(h.updates).toHaveLength(1);
    h.send([text({ text: "hi there", theme: "neon" })]);
    h.settle();
    expect(h.updates).toHaveLength(2);
  });

  it("waits for a pause: a newer change replaces the pending ask", () => {
    const h = harness();
    h.send([text({ theme: "a" })]);
    h.send([text({ theme: "b" })]);
    expect(h.timers.size).toBe(1);
  });

  it("asks again for any settings change of an alert area, which the page redraws", () => {
    const h = harness();
    h.send([{ id: "alert", widgetCanonicalId: "w:alert", settings: { text: "a" } }]);
    h.settle();
    h.send([{ id: "alert", widgetCanonicalId: "w:alert", settings: { text: "b" } }]);
    h.settle();
    expect(h.updates).toHaveLength(2);
  });

  it("points external media at what the server signed, and stops asking for it", () => {
    const h = harness();
    const url = "https://cdn.example.com/a.png";
    h.send([text({ image: { source: "url", url } })]);
    h.settle();
    expect(h.updates).toHaveLength(1);
    h.preview.answered({ mediaUrls: { a: { [url]: "/media/signed" } } });
    expect(h.preview.settingsFor(text({ image: { source: "url", url } }))).toEqual({
      image: { source: "url", url: "/media/signed" },
    });
    h.send([text({ image: { source: "url", url } })]);
    h.settle();
    expect(h.updates).toHaveLength(1);
  });

  it("keeps the layout and placements it was last sent", () => {
    const h = harness();
    expect(h.preview.placements()).toBeNull();
    h.send([text({})]);
    expect(h.preview.placements()).toEqual([text({})]);
    h.preview.handleMessage({ type: "something-else", placements: [] });
    expect(h.preview.placements()).toEqual([text({})]);
  });
});
