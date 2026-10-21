import { describe, expect, it } from "bun:test";
import { createSequencerState, entryIdOf } from "@woofx3/api/scene-editor";
import type { HeldScene, SceneWrite } from "../../src/scene/held-scene";
import { CLOSE_WRITE_ATTEMPTS, SceneWriteback } from "../../src/scene/scene-writeback";

const silent = { debug() {}, info() {}, warn() {}, error() {} } as never;

class Clock {
  time = 0;
  private id = 0;
  readonly timers = new Map<number, { at: number; fn: () => void }>();
  now = () => this.time;
  setTimeout = (fn: () => void, ms: number) => {
    this.id += 1;
    this.timers.set(this.id, { at: this.time + ms, fn });
    return this.id;
  };
  clearTimeout = (handle: unknown) => {
    this.timers.delete(handle as number);
  };
  async advance(ms: number) {
    this.time += ms;
    for (const [id, timer] of [...this.timers]) {
      if (timer.at <= this.time) {
        this.timers.delete(id);
        timer.fn();
      }
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function held(): HeldScene {
  const doc = { layout: { width: 1920, height: 1080 }, widgets: {}, behaviors: {} };
  return {
    sceneId: "s1",
    name: "Main",
    kind: "scene",
    state: createSequencerState({
      docs: { published: doc, draft: doc },
      hasDraft: false,
      editorState: { v: 0, headId: entryIdOf("e", 0), clients: {} },
      epoch: "e",
    }),
    meta: { published: {}, draft: {} },
    unframed: { published: new Set(), draft: new Set() },
    reframe: { timer: null, delayMs: 0 },
    overlaySeq: { published: 0, draft: 0 },
    editors: new Map(),
    save: { timer: null, dirty: false, docsDirty: false, writing: null, storedHeadId: null },
    unread: { published: { placements: [], columns: [] }, draft: { placements: [], columns: [] } },
  } as HeldScene;
}

function persister(outcomes: Array<"ok" | "fail"> = []) {
  const writes: SceneWrite[] = [];
  return {
    writes,
    updateScene: async (write: SceneWrite) => {
      writes.push(write);
      if (outcomes.shift() === "fail") {
        throw new Error("db down");
      }
    },
  };
}

describe("SceneWriteback", () => {
  it("writes a change once, after the autosave delay, however many changes came first", async () => {
    const clock = new Clock();
    const store = persister();
    const writeback = new SceneWriteback(store, clock, 2000, silent);
    const scene = held();
    writeback.markDirty(scene, true);
    writeback.markDirty(scene);
    await clock.advance(1999);
    expect(store.writes).toHaveLength(0);
    await clock.advance(1);
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]!.id).toBe("s1");
    expect(scene.save.dirty).toBe(false);
  });

  it("tries a failed write again on the next schedule", async () => {
    const clock = new Clock();
    const store = persister(["fail", "ok"]);
    const writeback = new SceneWriteback(store, clock, 100, silent);
    const scene = held();
    writeback.markDirty(scene);
    await clock.advance(100);
    expect(scene.save.dirty).toBe(true);
    await clock.advance(100);
    expect(store.writes).toHaveLength(2);
    expect(scene.save.dirty).toBe(false);
  });

  it("writes what is left on flush, and schedules nothing after", async () => {
    const clock = new Clock();
    const store = persister();
    const writeback = new SceneWriteback(store, clock, 2000, silent);
    const scene = held();
    writeback.markDirty(scene);
    await writeback.flush([scene]);
    expect(store.writes).toHaveLength(1);
    writeback.markDirty(scene);
    expect(clock.timers.size).toBe(0);
  });

  it("gives up on flush after its attempts", async () => {
    const clock = new Clock();
    const store = persister(Array(CLOSE_WRITE_ATTEMPTS).fill("fail"));
    const writeback = new SceneWriteback(store, clock, 2000, silent);
    const scene = held();
    writeback.markDirty(scene);
    const flushing = writeback.flush([scene]);
    for (let i = 0; i < CLOSE_WRITE_ATTEMPTS; i++) {
      await clock.advance(1000);
    }
    await flushing;
    expect(store.writes).toHaveLength(CLOSE_WRITE_ATTEMPTS);
    expect(scene.save.dirty).toBe(true);
  });

  it("leaves a scene with a column the load could not read unwritten at shutdown too", async () => {
    const clock = new Clock();
    const store = persister();
    const writeback = new SceneWriteback(store, clock, 2000, silent);
    const scene = held();
    scene.unread.published.columns = ["layout"];
    writeback.markDirty(scene);
    await writeback.flush([scene]);
    expect(store.writes).toHaveLength(0);
  });

  it("never writes a scene with a column the load could not read", async () => {
    const clock = new Clock();
    const store = persister();
    const writeback = new SceneWriteback(store, clock, 100, silent);
    const scene = held();
    scene.unread.published.columns = ["layout"];
    writeback.markDirty(scene);
    await clock.advance(1000);
    expect(store.writes).toHaveLength(0);
  });
});
