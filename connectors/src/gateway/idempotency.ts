import { createHash } from "node:crypto";
import type { Clock } from "../host/deps";

export interface IdempotencyConfig {
  /** Completed values kept; the least recently used goes first beyond it. */
  capacity: number;
  /** How long after completing a value is replayed. */
  ttlMs: number;
}

/**
 * - fresh: the work ran for this call.
 * - replayed: a completed value for the same key and fingerprint.
 * - coalesced: the same key and fingerprint was already running; this call waited for it.
 * - mismatch: the key is held by a different request, which is refused rather than replayed.
 */
export type IdempotencyOutcome<T> =
  | { kind: "fresh"; value: T }
  | { kind: "replayed"; value: T }
  | { kind: "coalesced"; value: T }
  | { kind: "mismatch" };

interface Completed<T> {
  fingerprint: string;
  value: T;
  completedAt: number;
}

interface Running<T> {
  fingerprint: string;
  done: Promise<T>;
}

/**
 * Runs work at most once per key within the TTL, in memory only: a restart
 * forgets every key. Work that throws is not stored, so the next call with
 * the key runs it again; only completed values are replayed. A caller can
 * also decline to keep a completed value (see `keep`), so a later call with
 * the key runs the work again.
 */
export class IdempotencyCache<T> {
  /** Map order is recency order: the first entry is the least recently used. */
  private readonly completed = new Map<string, Completed<T>>();
  private readonly running = new Map<string, Running<T>>();

  constructor(
    private readonly config: IdempotencyConfig,
    private readonly clock: Clock
  ) {
    if (!(Number.isInteger(config.capacity) && config.capacity > 0)) {
      throw new Error(`idempotency capacity must be a whole number above 0, got ${config.capacity}`);
    }
    if (!(Number.isInteger(config.ttlMs) && config.ttlMs > 0)) {
      throw new Error(`idempotency ttlMs must be a whole number of milliseconds above 0, got ${config.ttlMs}`);
    }
  }

  /** Completed values currently held, expired ones not yet evicted included. */
  get size(): number {
    return this.completed.size;
  }

  /**
   * `keep` decides whether a completed value is stored for replay. Calls that
   * were waiting on this run still receive the value either way.
   */
  async run(
    key: string,
    fingerprint: string,
    work: () => Promise<T>,
    keep: (value: T) => boolean = () => true
  ): Promise<IdempotencyOutcome<T>> {
    const completed = this.fresh(key);
    if (completed !== undefined) {
      if (completed.fingerprint !== fingerprint) {
        return { kind: "mismatch" };
      }
      this.completed.delete(key);
      this.completed.set(key, completed);
      return { kind: "replayed", value: completed.value };
    }

    const running = this.running.get(key);
    if (running !== undefined) {
      if (running.fingerprint !== fingerprint) {
        return { kind: "mismatch" };
      }
      return { kind: "coalesced", value: await running.done };
    }

    const done = (async () => work())();
    this.running.set(key, { fingerprint, done });
    try {
      const value = await done;
      if (keep(value)) {
        this.store(key, { fingerprint, value, completedAt: this.clock.now() });
      }
      return { kind: "fresh", value };
    } finally {
      this.running.delete(key);
    }
  }

  private fresh(key: string): Completed<T> | undefined {
    const completed = this.completed.get(key);
    if (completed === undefined) {
      return undefined;
    }
    if (this.clock.now() - completed.completedAt >= this.config.ttlMs) {
      this.completed.delete(key);
      return undefined;
    }
    return completed;
  }

  private store(key: string, completed: Completed<T>): void {
    this.completed.delete(key);
    this.completed.set(key, completed);
    while (this.completed.size > this.config.capacity) {
      const oldest = this.completed.keys().next();
      if (oldest.done) {
        break;
      }
      this.completed.delete(oldest.value);
    }
  }
}

/**
 * A hash of a JSON value that does not depend on key order, so the same
 * request fingerprints the same however its sender ordered its fields.
 */
export function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** JSON with object keys sorted at every level; undefined members are left out, as JSON.stringify does. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item ?? null)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
