import type { Clock } from "../host/deps";

export interface BoundedMapConfig {
  /** Entries kept; the least recently used goes first beyond it. */
  capacity: number;
  /** How long an entry is served after it was set. Undefined keeps entries until evicted. */
  ttlMs?: number;
}

interface Entry<V> {
  value: V;
  setAt: number;
}

/**
 * A map with a fixed capacity and an optional time limit, for per-viewer
 * state that must not grow with the number of chatters a stream ever sees.
 * Reading an entry makes it the most recently used.
 */
export class BoundedMap<K, V> {
  /** Map order is recency order: the first entry is the least recently used. */
  private readonly entries = new Map<K, Entry<V>>();

  constructor(
    private readonly config: BoundedMapConfig,
    private readonly clock: Clock
  ) {
    if (!(Number.isInteger(config.capacity) && config.capacity > 0)) {
      throw new Error(`a bounded map needs a whole-number capacity above 0, got ${config.capacity}`);
    }
    if (config.ttlMs !== undefined && !(Number.isInteger(config.ttlMs) && config.ttlMs > 0)) {
      throw new Error(`a bounded map needs a whole-number ttlMs above 0, got ${config.ttlMs}`);
    }
  }

  /** Entries held, expired ones not yet read included. */
  get size(): number {
    return this.entries.size;
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    this.entries.delete(key);
    if (this.config.ttlMs !== undefined && this.clock.now() - entry.setAt >= this.config.ttlMs) {
      return undefined;
    }
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, setAt: this.clock.now() });
    while (this.entries.size > this.config.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done) {
        break;
      }
      this.entries.delete(oldest.value);
    }
  }

  delete(key: K): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
