// Writing held scenes back to the database: each scene's documents and
// editor state in one row update, at most `autosaveMs` after the first
// change not yet written, one write per scene at a time, a failed write
// retried on the next change, and what is left written on shutdown.

import type { Logger } from "@woofx3/common/runtime";
import { errorText, type HeldScene, type ScenePersister, sceneWriteOf, unreadableColumns } from "./held-scene";

/**
 * Writes `flush()` tries before giving up on a scene, and the wait between
 * them. What is still unwritten then is lost with the process; editors that
 * had it are told so when they reconnect.
 */
export const CLOSE_WRITE_ATTEMPTS = 3;
export const CLOSE_RETRY_MS = 250;

export interface WritebackClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export class SceneWriteback {
  private closed = false;

  constructor(
    /** Null writes nothing back: the scenes are only held. */
    private readonly persister: ScenePersister | null,
    private readonly clock: WritebackClock,
    private readonly autosaveMs: number,
    private readonly logger: Logger
  ) {}

  /** Something changed: write the scene back, at most `autosaveMs` from now. */
  markDirty(held: HeldScene, docsChanged = false): void {
    held.save.dirty = true;
    held.save.docsDirty = held.save.docsDirty || docsChanged;
    this.schedule(held);
  }

  /**
   * Write the scene back now rather than after the autosave delay, waiting out
   * a write in flight first. True when the row holds what the scene holds
   * afterwards; false when the write failed (it is retried on the next
   * change) or cannot be made (no persister, or a column could not be read).
   */
  async writeNow(held: HeldScene): Promise<boolean> {
    if (held.save.timer !== null) {
      this.clock.clearTimeout(held.save.timer);
      held.save.timer = null;
    }
    while (held.save.writing !== null) {
      await held.save.writing;
    }
    if (this.persister === null || unreadableColumns(held).length > 0) {
      return false;
    }
    held.save.dirty = true;
    held.save.docsDirty = true;
    await this.write(held);
    return !held.save.dirty;
  }

  /**
   * Stop scheduling writes, and write each scene's unwritten changes, waiting
   * out any write in flight and trying `CLOSE_WRITE_ATTEMPTS` times.
   */
  async flush(scenes: Iterable<HeldScene>): Promise<void> {
    this.closed = true;
    await Promise.all(
      [...scenes].map(async (held) => {
        if (held.save.timer !== null) {
          this.clock.clearTimeout(held.save.timer);
          held.save.timer = null;
        }
        while (held.save.writing !== null) {
          await held.save.writing;
        }
        if (held.save.dirty && unreadableColumns(held).length > 0) {
          this.logger.warn("scene documents: changes left unwritten at shutdown; a column could not be read", {
            sceneId: held.sceneId,
            columns: unreadableColumns(held),
          });
          return;
        }
        for (let attempt = 1; held.save.dirty && attempt <= CLOSE_WRITE_ATTEMPTS; attempt++) {
          if (attempt > 1) {
            await new Promise<void>((resolve) => this.clock.setTimeout(resolve, CLOSE_RETRY_MS));
          }
          await this.write(held);
        }
        if (held.save.dirty) {
          this.logger.error("scene documents: changes could not be written before shutdown", {
            sceneId: held.sceneId,
            v: held.state.v,
          });
        }
      })
    );
  }

  private schedule(held: HeldScene): void {
    if (this.persister === null || held.save.timer !== null || held.save.writing !== null || this.closed) {
      return;
    }
    if (unreadableColumns(held).length > 0) {
      return;
    }
    held.save.timer = this.clock.setTimeout(() => {
      held.save.timer = null;
      void this.write(held);
    }, this.autosaveMs);
  }

  /**
   * One row update with both documents and the editor state, read in one
   * synchronous step so they describe the same head. A failed write is
   * retried on the next schedule.
   */
  private async write(held: HeldScene): Promise<void> {
    // A whole column the load could not read would be replaced by what the
    // document holds in its place (nothing); the row stays as it is. Checked
    // here, which every write goes through, the shutdown flush included.
    if (this.persister === null || held.save.writing !== null || unreadableColumns(held).length > 0) {
      return;
    }
    const write = sceneWriteOf(held, this.clock.now());
    const headId = held.state.headId;
    const docsChanged = held.save.docsDirty;
    held.save.dirty = false;
    held.save.docsDirty = false;
    const persister = this.persister;
    const writing = (async () => {
      try {
        await persister.updateScene(write);
        held.save.storedHeadId = headId;
      } catch (err) {
        held.save.dirty = true;
        held.save.docsDirty = held.save.docsDirty || docsChanged;
        this.logger.warn("scene documents: writing a scene back failed", {
          sceneId: held.sceneId,
          error: errorText(err),
        });
      }
    })();
    held.save.writing = writing;
    await writing;
    held.save.writing = null;
    if (held.save.dirty) {
      this.schedule(held);
    }
  }
}
