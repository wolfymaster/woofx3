import { describe, expect, it } from "bun:test";
import {
  AlertTimeline,
  MAX_ALERT_MS,
  SUBSCRIBE_TIMEOUT_MS,
  UNTIMED_ALERT_MS,
} from "../../public/scene-manager/alert-timeline";

describe("AlertTimeline", () => {
  it("lasts as long as its longest timed widget", () => {
    const timeline = new AlertTimeline(["audio", "video", "text"], 0);
    timeline.subscribed("audio", true);
    timeline.subscribed("video", true);
    timeline.subscribed("text", false);
    timeline.completed("audio");
    expect(timeline.isOver(1_000)).toBe(false);
    timeline.completed("video");
    expect(timeline.isOver(1_000)).toBe(true);
  });

  it("stays up for the untimed length when no widget has a length of its own", () => {
    const timeline = new AlertTimeline(["text", "image"], 0);
    timeline.subscribed("text", false);
    timeline.subscribed("image", false);
    timeline.completed("text");
    expect(timeline.isOver(UNTIMED_ALERT_MS - 1)).toBe(false);
    expect(timeline.isOver(UNTIMED_ALERT_MS)).toBe(true);
  });

  it("waits for a widget that has not subscribed, up to the subscribe timeout", () => {
    const timeline = new AlertTimeline(["audio", "slow"], 0);
    timeline.subscribed("audio", true);
    timeline.completed("audio");
    expect(timeline.isOver(SUBSCRIBE_TIMEOUT_MS - 1)).toBe(false);
    expect(timeline.isOver(SUBSCRIBE_TIMEOUT_MS)).toBe(true);
  });

  it("ignores a completion from a widget it is not waiting on", () => {
    const timeline = new AlertTimeline(["video"], 0);
    timeline.completed("video");
    timeline.subscribed("video", true);
    expect(timeline.isOver(1)).toBe(false);
  });

  it("ends at the cap however long a widget runs", () => {
    const timeline = new AlertTimeline(["video"], 0);
    timeline.subscribed("video", true);
    expect(timeline.isOver(MAX_ALERT_MS - 1)).toBe(false);
    expect(timeline.isOver(MAX_ALERT_MS)).toBe(true);
  });
});
