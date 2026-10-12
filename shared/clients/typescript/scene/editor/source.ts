// Where the editor's document lives. The one difference between editing a
// scene and editing an alert is the source: a scene is edited live through
// the engine's sync session (see sync-source.ts), an alert on an engine
// without stored compositions is edited in memory and handed back whole.
//
// A source holds the committed document and takes changes as functions of
// it, so a change is always made against the document as it is at that
// moment, never against a copy the caller held on to. The editor does not
// need to be told which changes came from elsewhere: it remembers the last
// document it saw and works out what others changed by comparing.

import { assert, isCompositionShape } from "../model/composition";
import type { CompositionDocument } from "../model/types";

export type ApplyResult = { ok: true } | { ok: false; detail: string };

/** Another editor working on the same document. */
export interface Peer {
  id: string;
  name: string;
  /** The placement they have selected, if any. */
  selection: string | null;
}

/** Who else is editing, for a source that has others. */
export interface PresenceChannel {
  peers(): readonly Peer[];
  /** Tell the others what this editor has selected. */
  setSelection(selection: string | null): void;
}

/** What the source's store keeps, beyond the canvas, its placements and their behaviors. */
export interface SourceFeatures {
  /** Inputs (`inputs`) are stored; without this, a change to them is refused. */
  inputs: boolean;
}

export interface DocumentSource {
  /** The document as it stands, or null until it has loaded. The same object until it changes. */
  getDocument(): CompositionDocument | null;
  /** Whether changes are refused now: a viewer, or a draft locked while a publish is pending. */
  readonly readOnly: boolean;
  /** Why changes are refused now, in words a user can be shown; null exactly when `readOnly` is false. */
  readonly readOnlyReason: string | null;
  readonly features: SourceFeatures;
  /** Called after the document, `readOnly` or presence changed. */
  subscribe(listener: () => void): () => void;
  /**
   * Change the document: `update` gets a copy of it as it stands and returns
   * the next one. The change shows at once when accepted; a refused change
   * changes nothing.
   */
  apply(update: (doc: CompositionDocument) => CompositionDocument): ApplyResult;
  readonly presence?: PresenceChannel;
}

const READ_ONLY = "the document is read-only";

/**
 * A document held in memory. Used where there is no sync session: an alert
 * edited on an engine that does not store compositions (the caller reads
 * `getDocument()` when the user is done), and tests.
 */
export class LocalDocumentSource implements DocumentSource {
  readonly features: SourceFeatures = { inputs: true };
  private doc: CompositionDocument;
  private lockedBecause: string | null;
  private readonly listeners = new Set<() => void>();

  constructor(doc: CompositionDocument, options: { readOnly?: boolean } = {}) {
    assert(isCompositionShape(doc), "a local source starts from a composition");
    this.doc = structuredClone(doc);
    this.lockedBecause = options.readOnly === true ? READ_ONLY : null;
  }

  get readOnly(): boolean {
    return this.lockedBecause !== null;
  }

  get readOnlyReason(): string | null {
    return this.lockedBecause;
  }

  getDocument(): CompositionDocument {
    return this.doc;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  apply(update: (doc: CompositionDocument) => CompositionDocument): ApplyResult {
    if (this.lockedBecause !== null) {
      return { ok: false, detail: this.lockedBecause };
    }
    const next = update(structuredClone(this.doc));
    if (!isCompositionShape(next)) {
      return { ok: false, detail: "the change does not leave a composition" };
    }
    this.doc = next;
    this.changed();
    return { ok: true };
  }

  /** Replace the whole document, as a change from elsewhere would. */
  replace(doc: CompositionDocument): void {
    assert(isCompositionShape(doc), "a local source holds a composition");
    this.doc = structuredClone(doc);
    this.changed();
  }

  /** Lock or unlock the document; `reason` is what a refused change says, defaulting to a plain read-only. */
  setReadOnly(readOnly: boolean, reason: string = READ_ONLY): void {
    assert(reason.length > 0, "a read-only reason says something");
    const next = readOnly ? reason : null;
    if (this.lockedBecause !== next) {
      this.lockedBecause = next;
      this.changed();
    }
  }

  private changed(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}
