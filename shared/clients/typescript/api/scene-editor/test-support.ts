// Fixtures and a manual clock for the scene editor tests. Not exported from
// the package index: only tests import it.

import type { SyncClock } from "./client";
import type { PlacementDocument, SceneDocument, Version } from "./document";

export function placement(overrides: Partial<PlacementDocument> = {}): PlacementDocument {
  return {
    widget: "example.widget",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    visible: true,
    z: "a0000",
    settings: {},
    name: "",
    rotation: 0,
    opacity: 1,
    locked: false,
    extra: {},
    ...overrides,
  };
}

export function sceneDoc(widgets: Record<string, PlacementDocument> = {}): SceneDocument {
  return { layout: { width: 1920, height: 1080 }, widgets };
}

export function bothDocs(doc: SceneDocument): Record<Version, SceneDocument> {
  return { draft: structuredClone(doc), published: structuredClone(doc) };
}

/** Resolve pending promise callbacks a few turns deep. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

/** A clock that moves only when told, running due timers in order. */
export class ManualClock implements SyncClock {
  private time = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + Math.max(0, ms), callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  pending(): number {
    return this.timers.size;
  }

  /** Move forward `ms`, running every timer that falls due, earliest first, settling promises after each. */
  async advance(ms: number): Promise<void> {
    const end = this.time + ms;
    for (;;) {
      let due: [number, { at: number; callback: () => void }] | null = null;
      for (const entry of this.timers) {
        if (entry[1].at <= end && (due === null || entry[1].at < due[1].at)) {
          due = entry;
        }
      }
      if (due === null) {
        break;
      }
      this.timers.delete(due[0]);
      this.time = due[1].at;
      due[1].callback();
      await flush();
    }
    this.time = end;
    await flush();
  }
}
