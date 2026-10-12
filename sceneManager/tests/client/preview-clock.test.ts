import { describe, expect, it } from "bun:test";
import { createPreviewClock } from "../../public/scene-manager/preview-clock";

/** A base clock that moves only when a test advances it, firing due timers in order. */
class FakeClock {
  time = 1_000;
  private next = 1;
  private readonly timers = new Map<number, { atMs: number; callback: () => void }>();

  now(): number {
    return this.time;
  }

  setTimer(atMs: number, callback: () => void): number {
    const handle = this.next;
    this.next += 1;
    this.timers.set(handle, { atMs, callback });
    return handle;
  }

  clearTimer(handle: number): void {
    this.timers.delete(handle);
  }

  armed(): number {
    return this.timers.size;
  }

  advanceBy(ms: number): void {
    const until = this.time + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.atMs <= until)
        .sort(([, a], [, b]) => a.atMs - b.atMs)[0];
      if (due === undefined) {
        break;
      }
      this.timers.delete(due[0]);
      this.time = Math.max(this.time, due[1].atMs);
      due[1].callback();
    }
    this.time = until;
  }
}

describe("createPreviewClock", () => {
  it("starts paused at 0 and runs only while playing", () => {
    const base = new FakeClock();
    const clock = createPreviewClock(base);
    expect(clock.now()).toBe(0);
    expect(clock.playing()).toBe(false);
    base.advanceBy(500);
    expect(clock.now()).toBe(0);
    clock.play();
    base.advanceBy(300);
    expect(clock.now()).toBe(300);
    clock.pause();
    base.advanceBy(1_000);
    expect(clock.now()).toBe(300);
    clock.play();
    base.advanceBy(200);
    expect(clock.now()).toBe(500);
  });

  it("seeks either way, playing or paused", () => {
    const base = new FakeClock();
    const clock = createPreviewClock(base);
    clock.seek(2_000);
    expect(clock.now()).toBe(2_000);
    clock.play();
    base.advanceBy(100);
    clock.seek(50);
    expect(clock.now()).toBe(50);
    base.advanceBy(100);
    expect(clock.now()).toBe(150);
    expect(() => clock.seek(-1)).toThrow();
    expect(() => clock.seek(Number.NaN)).toThrow();
  });

  it("fires timers in composition time, never while paused", () => {
    const base = new FakeClock();
    const clock = createPreviewClock(base);
    const fired: Array<[string, number]> = [];
    clock.setTimer(500, () => fired.push(["a", clock.now()]));
    clock.setTimer(200, () => fired.push(["b", clock.now()]));
    expect(base.armed()).toBe(0);
    base.advanceBy(1_000);
    expect(fired).toEqual([]);

    clock.play();
    base.advanceBy(300);
    expect(fired).toEqual([["b", 200]]);
    clock.pause();
    expect(base.armed()).toBe(0);
    base.advanceBy(1_000);
    expect(fired).toEqual([["b", 200]]);
    clock.play();
    base.advanceBy(200);
    expect(fired).toEqual([
      ["b", 200],
      ["a", 500],
    ]);
  });

  it("fires a timer a seek jumped past once it plays, and a cleared one never", () => {
    const base = new FakeClock();
    const clock = createPreviewClock(base);
    const fired: string[] = [];
    clock.setTimer(400, () => fired.push("due"));
    const cleared = clock.setTimer(450, () => fired.push("cleared"));
    clock.clearTimer(cleared);
    clock.seek(1_000);
    expect(fired).toEqual([]);
    clock.play();
    base.advanceBy(0);
    expect(fired).toEqual(["due"]);
  });

  it("stops a run of due timers when one of them pauses the clock", () => {
    const base = new FakeClock();
    const clock = createPreviewClock(base);
    const fired: string[] = [];
    clock.setTimer(100, () => {
      fired.push("first");
      clock.pause();
    });
    clock.setTimer(100, () => fired.push("second"));
    clock.play();
    base.advanceBy(200);
    expect(fired).toEqual(["first"]);
    clock.play();
    base.advanceBy(0);
    expect(fired).toEqual(["first", "second"]);
  });

  it("refuses use after dispose", () => {
    const base = new FakeClock();
    const clock = createPreviewClock(base);
    clock.setTimer(100, () => {});
    clock.play();
    clock.dispose();
    expect(base.armed()).toBe(0);
    expect(() => clock.setTimer(5, () => {})).toThrow();
    expect(() => clock.play()).toThrow();
  });
});
