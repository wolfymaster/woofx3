// A document source over the engine's scene sync session.
//
// The sync client (api/scene-editor/client.ts) holds both of a scene's
// versions and shows each as the server confirmed it plus this editor's
// pending edits. This source exposes one version as a composition and sends
// changes through `edit`, which diffs the result in the shapes the server
// accepts and queues it. A change the server later refuses is rolled back by
// the client (the refused edit's inverse is applied as if it came from
// elsewhere); the editor sees that as a change from elsewhere too, and its
// history drops what that leaves with nothing to undo.
//
// Only the layout and the collections reach the server. The client refuses
// a change to `inputs` or `base` (the engine never takes them from an
// editor) and does not diff any other top-level key, so a change to one
// would be refused with a reason about op paths, or silently lost. This
// source refuses both itself, saying what the scene does not store.

import type { SceneSyncClient } from "../../api/scene-editor/client";
import type { Version } from "../../api/scene-editor/document";
import { sameValue } from "../model/composition";
import type { CompositionDocument } from "../model/types";
import type { ApplyResult, DocumentSource, Peer, PresenceChannel, SourceFeatures } from "./source";

/** The part of the sync client this source uses. */
export type SyncClientPort = Pick<SceneSyncClient, "getState" | "subscribe" | "edit" | "setPresence">;

export interface SyncDocumentSourceOptions {
  client: SyncClientPort;
  /** Which of the scene's versions to edit: the draft, or the published scene when editing live. */
  version: Version;
  /** Never take changes: someone who may only watch. */
  readOnly?: boolean;
}

/** The top-level parts of a composition the sync session stores. */
const SYNCED_PARTS: ReadonlySet<string> = new Set(["layout", "widgets", "behaviors"]);

export class SyncDocumentSource implements DocumentSource {
  readonly presence: PresenceChannel;
  readonly features: SourceFeatures = { inputs: false };
  private readonly client: SyncClientPort;
  private readonly version: Version;
  private readonly options: SyncDocumentSourceOptions;

  constructor(options: SyncDocumentSourceOptions) {
    this.options = options;
    this.client = options.client;
    this.version = options.version;
    this.presence = {
      peers: () => this.peers(),
      setSelection: (selection) => this.client.setPresence(selection, this.version),
    };
  }

  get readOnly(): boolean {
    return this.readOnlyReason !== null;
  }

  /**
   * Read-only before the scene loads, after the session ended, and, for the
   * draft, while a publish or discard is pending.
   *
   * The last is a choice, not a limit of the session: the sync client
   * carries draft edits queued behind a command past it (it transforms them
   * against the command's result, as it does for anyone else's change). But
   * an edit made while Publish is pending would land in a new draft after
   * the publish, not on stream, and one made while Discard is pending would
   * outlive the discard on the reset draft; neither is what someone who just
   * pressed the button expects. So the draft holds still until the engine
   * answers, and the reason says why, for the editor to show.
   */
  get readOnlyReason(): string | null {
    if (this.options.readOnly === true) {
      return "you can only watch this scene";
    }
    const state = this.client.getState();
    if (state.conn === "gone") {
      return "this scene no longer exists";
    }
    if (state.conn === "closed") {
      return "the editing session has ended";
    }
    if (state.local === null) {
      return "the scene has not loaded yet";
    }
    if (this.version === "draft" && state.pendingCommand === "publish") {
      return "the draft is being published";
    }
    if (this.version === "draft" && state.pendingCommand === "discard") {
      return "the draft is being discarded";
    }
    return null;
  }

  /** The client's own document, which it keeps while unchanged and has normalized (it always has `behaviors`). */
  getDocument(): CompositionDocument | null {
    const local = this.client.getState().local;
    return local === null ? null : local[this.version];
  }

  subscribe(listener: () => void): () => void {
    return this.client.subscribe(listener);
  }

  apply(update: (doc: CompositionDocument) => CompositionDocument): ApplyResult {
    const locked = this.readOnlyReason;
    if (locked !== null) {
      return { ok: false, detail: locked };
    }
    const outcome: { refusal: string | null } = { refusal: null };
    const result = this.client.edit(this.version, (scene) => {
      const next = update(structuredClone(scene));
      outcome.refusal = unstoredChange(scene, next);
      return outcome.refusal === null ? next : scene;
    });
    if (outcome.refusal !== null) {
      return { ok: false, detail: outcome.refusal };
    }
    return result.ok ? { ok: true } : { ok: false, detail: result.detail };
  }

  private peers(): Peer[] {
    return this.client
      .getState()
      .peers.filter((peer) => peer.version === this.version)
      .map((peer) => ({ id: peer.clientId, name: peer.name, selection: peer.selection }));
  }
}

/** Why `next` changes a part of the document the session does not store, or null when it does not. */
function unstoredChange(before: CompositionDocument, next: CompositionDocument): string | null {
  const was = before as unknown as Record<string, unknown>;
  const is = next as unknown as Record<string, unknown>;
  for (const part of new Set([...Object.keys(was), ...Object.keys(is)])) {
    if (!SYNCED_PARTS.has(part) && !sameValue(was[part], is[part])) {
      return `a scene does not store ${part}`;
    }
  }
  return null;
}
