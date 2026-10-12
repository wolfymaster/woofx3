// Undo and redo of this editor's own changes, in a document others edit too.
//
// Each entry holds the op that undoes one of this user's changes, made
// against the document as it was right after that change. When another
// editor's change arrives, every entry is transformed past it, so an undo
// still applies to the document as it now is and reverts only what this
// user did. Where the other editor changed the same value since, the undo
// yields: transformed as the `right` side, its replace of that value becomes
// a no-op rather than overwriting the newer change.

import { assert } from "../model/composition";
import { composeOps, invertOps, type Ops, transformOps, withoutNoops } from "./ops";

/** Edits with the same coalescing key this close together undo as one (typing in a field). */
export const COALESCE_WINDOW_MS = 1000;
/** Oldest entries are dropped past this many. */
export const MAX_HISTORY_ENTRIES = 200;

interface UndoEntry {
  ops: Ops;
  coalesceKey: string | null;
  at: number;
}

export class EditHistory {
  /** Oldest first: the last entry undoes the most recent change. */
  private undoStack: UndoEntry[] = [];
  /** Oldest first: the last entry redoes the most recently undone change. */
  private redoStack: Ops[] = [];

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Record a change this user made (`ops`, forward). A change with the same
   * `coalesceKey` as the last one, within the window, joins it, so one undo
   * reverts both. Any new change ends the redo chain.
   */
  record(ops: Ops, coalesceKey: string | null, at: number): void {
    if (ops.length === 0) {
      return;
    }
    const inverse = invertOps(ops);
    this.redoStack = [];
    const top = this.undoStack[this.undoStack.length - 1];
    if (
      coalesceKey !== null &&
      top !== undefined &&
      top.coalesceKey === coalesceKey &&
      at - top.at <= COALESCE_WINDOW_MS
    ) {
      top.ops = composeOps(inverse, top.ops);
      top.at = at;
      return;
    }
    this.undoStack.push({ ops: inverse, coalesceKey, at });
    if (this.undoStack.length > MAX_HISTORY_ENTRIES) {
      this.undoStack.shift();
    }
  }

  /** The op that undoes the most recent change, applying to the current document; null when there is none. */
  peekUndo(): Ops | null {
    return this.undoStack[this.undoStack.length - 1]?.ops ?? null;
  }

  peekRedo(): Ops | null {
    return this.redoStack[this.redoStack.length - 1] ?? null;
  }

  /** The undo was applied, as `applied` (forward ops actually made): it moves to the redo chain. */
  undone(applied: Ops): void {
    assert(this.undoStack.length > 0, "an undo follows a recorded change");
    this.undoStack.pop();
    if (applied.length > 0) {
      this.redoStack.push(invertOps(applied));
    }
  }

  /** The redo was applied, as `applied`: it moves back to the undo chain without ending the redo chain. */
  redone(applied: Ops): void {
    assert(this.redoStack.length > 0, "a redo follows an undo");
    this.redoStack.pop();
    if (applied.length > 0) {
      this.undoStack.push({ ops: invertOps(applied), coalesceKey: null, at: Number.NEGATIVE_INFINITY });
    }
  }

  /** Drop the entry on top of a chain, for one that no longer applies. */
  dropUndo(): void {
    this.undoStack.pop();
  }

  dropRedo(): void {
    this.redoStack.pop();
  }

  /**
   * Another editor changed the document by `remote`, made against the
   * document every top entry applies to. Each entry is moved past it, top
   * first, carrying `remote` down the chain as it goes; entries left with
   * nothing to do are dropped.
   */
  transformPast(remote: Ops): void {
    if (remote.length === 0) {
      return;
    }
    let past = remote;
    const undo: UndoEntry[] = [];
    for (let i = this.undoStack.length - 1; i >= 0; i--) {
      const entry = this.undoStack[i] as UndoEntry;
      const moved = withoutNoops(transformOps(entry.ops, past, "right"));
      past = transformOps(past, entry.ops, "left");
      if (moved.length > 0) {
        // A coalesced edit after another editor's change starts a new entry.
        undo.unshift({ ops: moved, coalesceKey: null, at: entry.at });
      }
    }
    this.undoStack = undo;
    past = remote;
    const redo: Ops[] = [];
    for (let i = this.redoStack.length - 1; i >= 0; i--) {
      const ops = this.redoStack[i] as Ops;
      const moved = withoutNoops(transformOps(ops, past, "right"));
      past = transformOps(past, ops, "left");
      if (moved.length > 0) {
        redo.unshift(moved);
      }
    }
    this.redoStack = redo;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
