// The page's copy of the module storage its widgets read through
// `host.storage`. A key is fetched from the server the first time a
// widget subscribes to it, and from then on kept current by the
// `module-state` frames the scene's event stream pushes (see
// src/scene/module-state.ts). `storage.get` in the widget protocol is
// answered synchronously from here, so it sees only keys already loaded.
//
// Keyed by the module the scene record places each widget in, never by
// the module a widget names in its `hello`: that claim is unchecked.

/** A placed widget subscribed to a key. */
export interface ModuleStateTarget {
  /** The placement a fetch is made through; the server reads that placement's module. */
  instanceId: string;
  sendStorageValue(key: string, value: unknown): void;
}

/** Fetch one key's current value through a placement; rejects when the server cannot say. */
export type ModuleStateFetcher = (instanceId: string, key: string) => Promise<unknown>;

interface Entry {
  moduleId: string;
  key: string;
  known: boolean;
  value: unknown;
  /** Bumped by every pushed change, so a fetch that raced one can tell it is stale. */
  generation: number;
  loading: boolean;
  /** Subscriptions per target: a widget may subscribe to one key more than once. */
  targets: Map<ModuleStateTarget, number>;
}

export class ModuleStateCache {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly fetchValue: ModuleStateFetcher) {}

  /** The loaded value of a key, or `null` when it has not loaded yet. */
  peek(moduleId: string, key: string): unknown {
    const entry = this.entries.get(entryKey(moduleId, key));
    return entry?.known ? entry.value : null;
  }

  /** Send `target` the key's value now if it is loaded, and every change after. */
  watch(moduleId: string, key: string, target: ModuleStateTarget): void {
    const entry = this.entry(moduleId, key);
    entry.targets.set(target, (entry.targets.get(target) ?? 0) + 1);
    if (entry.known) {
      target.sendStorageValue(key, entry.value);
      return;
    }
    void this.load(entry);
  }

  unwatch(moduleId: string, key: string, target: ModuleStateTarget): void {
    const entry = this.entries.get(entryKey(moduleId, key));
    const count = entry?.targets.get(target);
    if (!entry || count === undefined) {
      return;
    }
    if (count > 1) {
      entry.targets.set(target, count - 1);
    } else {
      entry.targets.delete(target);
    }
  }

  /** A change pushed on the event stream. Always newer than any fetch still in flight. */
  apply(moduleId: string, key: string, value: unknown): void {
    const entry = this.entries.get(entryKey(moduleId, key));
    if (!entry) {
      return;
    }
    entry.generation += 1;
    this.settle(entry, value);
  }

  /**
   * Fetch every watched key again. Called when the event stream reconnects,
   * because changes made while it was down were pushed to nobody.
   */
  refresh(): void {
    for (const entry of this.entries.values()) {
      if (entry.targets.size > 0) {
        void this.load(entry);
      }
    }
  }

  private entry(moduleId: string, key: string): Entry {
    const id = entryKey(moduleId, key);
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { moduleId, key, known: false, value: null, generation: 0, loading: false, targets: new Map() };
      this.entries.set(id, entry);
    }
    return entry;
  }

  private async load(entry: Entry): Promise<void> {
    if (entry.loading) {
      return;
    }
    const via = entry.targets.keys().next().value;
    if (via === undefined) {
      return;
    }
    entry.loading = true;
    const generation = entry.generation;
    let value: unknown;
    try {
      value = await this.fetchValue(via.instanceId, entry.key);
    } catch {
      // Left unloaded; the next reconnect's refresh asks again.
      return;
    } finally {
      entry.loading = false;
    }
    if (entry.generation !== generation) {
      return;
    }
    this.settle(entry, value);
  }

  private settle(entry: Entry, value: unknown): void {
    entry.known = true;
    entry.value = value;
    for (const target of entry.targets.keys()) {
      target.sendStorageValue(entry.key, value);
    }
  }
}

function entryKey(moduleId: string, key: string): string {
  return `${moduleId}\u0000${key}`;
}
