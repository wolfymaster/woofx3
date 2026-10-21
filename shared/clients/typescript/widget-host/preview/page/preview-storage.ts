// The module storage a previewed widget reads, held in the page and edited
// by hand. It answers a frame as the overlay's module state does on stream:
// a key reads `null` until a frame watches it, a watch is sent the key's
// value at once (`null` when it holds none), and every change after.

import type { WidgetStorageAccess } from "../../page";

/** Where a watched key's values go: a frame's bridge. */
export interface StorageTarget {
  sendStorageValue(key: string, value: unknown): void;
}

export class PreviewStorage {
  private readonly values = new Map<string, unknown>();
  /** Per key, each watching target and how many of its subscriptions watch it. */
  private readonly watches = new Map<string, Map<StorageTarget, number>>();

  /** Every key that holds a value, in the order they were first set. */
  entries(): Array<[string, unknown]> {
    return [...this.values];
  }

  /** Hold `value` for `key`, and send it to every frame watching it. */
  set(key: string, value: unknown): void {
    this.values.set(key, value);
    this.send(key);
  }

  delete(key: string): void {
    this.values.delete(key);
    this.send(key);
  }

  /** The storage a frame of `target` is given. */
  access(target: StorageTarget): WidgetStorageAccess {
    return {
      get: (key) => (this.watches.has(key) ? (this.values.get(key) ?? null) : null),
      subscribe: (key) => {
        let targets = this.watches.get(key);
        if (targets === undefined) {
          targets = new Map();
          this.watches.set(key, targets);
        }
        targets.set(target, (targets.get(target) ?? 0) + 1);
        target.sendStorageValue(key, this.values.get(key) ?? null);
      },
      unsubscribe: (key) => {
        const targets = this.watches.get(key);
        const count = targets?.get(target);
        if (targets === undefined || count === undefined) {
          return;
        }
        if (count > 1) {
          targets.set(target, count - 1);
        } else {
          targets.delete(target);
        }
      },
    };
  }

  /** Drop every watch `target` holds, for a frame leaving the page. */
  unwatchAll(target: StorageTarget): void {
    for (const targets of this.watches.values()) {
      targets.delete(target);
    }
  }

  private send(key: string): void {
    const value = this.values.get(key) ?? null;
    for (const target of this.watches.get(key)?.keys() ?? []) {
      target.sendStorageValue(key, value);
    }
  }
}
