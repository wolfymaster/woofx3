// A scene the scene documents hold, and the pure reads of one: what it
// writes back, its snapshots and views, and what of it a load could not read.

import type { CompositionKind } from "@woofx3/api";
import {
  type EditorSnapshot,
  editorStateOf,
  type MetaChanges,
  type PlacementMeta,
  type SceneDocument,
  type SceneSnapshot,
  type SequencerState,
  type ServerMessage,
  sameValue,
  type UnreadReport,
  type Version,
} from "@woofx3/api/scene-editor";
import { documentsDigest, storedSceneOf } from "./scene-codec";
import type { OverlaySceneState, StoredColumn, StoredUnread } from "./scene-host";

/** What the documents write a scene back with; unset fields are left alone. */
export interface SceneWrite {
  id: string;
  widgetsJson?: string;
  layoutJson?: string;
  behaviorsJson?: string;
  draftWidgetsJson?: string;
  draftLayoutJson?: string;
  /** Stored with the draft's widgets and layout. */
  draftBehaviorsJson?: string;
  clearDraft?: boolean;
  /** The scene editor's sync state, stored in the same row update as the documents. */
  editorStateJson?: string;
}

/** The slice of the db client the documents write scenes through. */
export interface ScenePersister {
  updateScene(write: SceneWrite): Promise<unknown>;
}

/** A scene row's stored text for each column a repair can set aside, by version; "" for a draft column of a scene with no draft. */
export type StoredColumnsText = Record<Version, Record<StoredColumn, string>>;

/** Stored data a repair sets aside (`SceneBackup` in the db's scene.proto). */
export interface SceneBackupEntry {
  version: Version;
  column: StoredColumn;
  reason: "unreadable_column" | "unreadable_placements";
  /** The column's whole stored text, or a JSON array of the placements that could not be read. */
  content: string;
}

/** Where a repair reads a scene's stored text and sets aside what could not be read (the db proxy). */
export interface SceneBackupStore {
  /** Null when the scene's row no longer exists. */
  storedColumns(sceneId: string): Promise<StoredColumnsText | null>;
  /** Stores every backup or none; rejects when they were not stored. */
  store(sceneId: string, backups: SceneBackupEntry[]): Promise<void>;
}

/** One editor socket, as the documents talk to it. */
export interface EditorConnection {
  send(message: ServerMessage): void;
  close(code: number, reason: string): void;
}

export interface EditorRecord {
  conn: EditorConnection;
  name: string;
  presence: { selection: string | null; version: Version } | null;
  /** The editor is draining before it closes: hidden from the others. */
  away: boolean;
}

export interface SaveState {
  timer: unknown | null;
  /** Something to write (documents or editor state) since the last write began. */
  dirty: boolean;
  /** A document changed since the last write began. */
  docsDirty: boolean;
  writing: Promise<void> | null;
  /** The head the stored editor state names, or null when it names none of this load's. */
  storedHeadId: string | null;
}

export interface ReframeState {
  timer: unknown | null;
  /** The wait before the next retry, doubled by each one. */
  delayMs: number;
}

export interface HeldScene {
  sceneId: string;
  name: string;
  /** Fixed when the row is created, so never changes while held. */
  kind: CompositionKind;
  state: SequencerState;
  meta: Record<Version, Record<string, PlacementMeta>>;
  /** Placements whose meta was worked out without barkloader's answer, so
   *  their frame URL is unversioned and their `mediaProxyBase` unknown. */
  unframed: Record<Version, Set<string>>;
  reframe: ReframeState;
  /** Each version's overlay sequence number: bumped by every entry that changes that version's ops or meta. */
  overlaySeq: Record<Version, number>;
  /** The scene's editors by clientId: one socket per client. */
  editors: Map<string, EditorRecord>;
  save: SaveState;
  /** Each version's stored data that the load could not read (see `StoredUnread`). */
  unread: Record<Version, StoredUnread>;
}

export interface MetaPlan {
  next: Record<Version, Record<string, PlacementMeta>>;
  unframed: Record<Version, Set<string>>;
  changes: Partial<Record<Version, MetaChanges>>;
}

/** A version's document and meta, as they stood before a commit or after it. */
export interface VersionView {
  doc: SceneDocument;
  meta: Record<string, PlacementMeta>;
}

export type ScenesView = Record<Version, VersionView>;

/** A change that leaves every placement's meta as it is. */
export function noMeta(held: HeldScene): MetaPlan {
  return { next: held.meta, unframed: held.unframed, changes: {} };
}

export function unreadOf(state: OverlaySceneState): StoredUnread {
  return state.unread ?? { placements: [], columns: [] };
}

/** The stored columns of either version that the load could not read at all. */
export function unreadableColumns(held: HeldScene): StoredColumn[] {
  return [...new Set([...held.unread.published.columns, ...held.unread.draft.columns])];
}

/** The versions whose stored data is the scene's own: a scene with no draft reads its published row as the draft. */
function storedVersions(held: HeldScene): Version[] {
  return held.state.hasDraft ? ["published", "draft"] : ["published"];
}

/** What of the scene's stored data could not be read, as editors are told it; null when all of it could. */
export function unreadReportOf(held: HeldScene): UnreadReport | null {
  const versions = storedVersions(held);
  const columns = versions.flatMap((version) => held.unread[version].columns.map((column) => ({ version, column })));
  const placements = {
    published: held.unread.published.placements.length,
    draft: held.state.hasDraft ? held.unread.draft.placements.length : 0,
  };
  if (columns.length === 0 && placements.published === 0 && placements.draft === 0) {
    return null;
  }
  return { columns, placements };
}

/**
 * What a repair sets aside: each unreadable column's whole stored text, and
 * each version's unreadable placements as stored. A column that could not be
 * read has no placements of its own to list, so the two never overlap.
 */
export function sceneBackupsOf(held: HeldScene, stored: StoredColumnsText): SceneBackupEntry[] {
  const backups: SceneBackupEntry[] = [];
  for (const version of storedVersions(held)) {
    const unread = held.unread[version];
    for (const column of unread.columns) {
      backups.push({ version, column, reason: "unreadable_column", content: stored[version][column] });
    }
    if (unread.placements.length > 0) {
      backups.push({
        version,
        column: "widgets",
        reason: "unreadable_placements",
        content: JSON.stringify(unread.placements),
      });
    }
  }
  return backups;
}

export function unreadableDetail(columns: StoredColumn[]): string {
  return `the scene's stored ${columns.join(", ")} could not be read, so it cannot be changed without losing them`;
}

export function savePending(held: HeldScene): boolean {
  return held.save.dirty || held.save.timer !== null || held.save.writing !== null;
}

export function sceneWriteOf(held: HeldScene, now: number): SceneWrite {
  const { docs, hasDraft } = held.state;
  // With no draft the draft column is cleared; the draft's unread placements
  // are then the published ones (see `SceneDocuments.afterCommit`).
  const published = storedSceneOf(docs.published, held.unread.published.placements);
  const draft = hasDraft
    ? (() => {
        const stored = storedSceneOf(docs.draft, held.unread.draft.placements);
        return {
          draftWidgetsJson: stored.widgetsJson,
          draftLayoutJson: stored.layoutJson,
          draftBehaviorsJson: stored.behaviorsJson,
        };
      })()
    : { clearDraft: true };
  const editorState = { ...editorStateOf(held.state, now), digest: documentsDigest(docs) };
  return {
    id: held.sceneId,
    widgetsJson: published.widgetsJson,
    layoutJson: published.layoutJson,
    behaviorsJson: published.behaviorsJson,
    ...draft,
    editorStateJson: JSON.stringify(editorState),
  };
}

/** The digest stored beside the sequencer's fields, or null when there is none. */
export function storedDigestOf(json: string): string | null {
  try {
    const value: unknown = JSON.parse(json);
    if (typeof value === "object" && value !== null && typeof (value as { digest?: unknown }).digest === "string") {
      return (value as { digest: string }).digest;
    }
  } catch {
    return null;
  }
  return null;
}

export function snapshotOf(held: HeldScene, version: Version): SceneSnapshot {
  return {
    sceneId: held.sceneId,
    name: held.name,
    seq: held.overlaySeq[version],
    doc: held.state.docs[version],
    meta: held.meta[version],
  };
}

export function viewOf(held: HeldScene): ScenesView {
  return {
    published: { doc: held.state.docs.published, meta: held.meta.published },
    draft: { doc: held.state.docs.draft, meta: held.meta.draft },
  };
}

export function editorSnapshotOf(held: HeldScene): EditorSnapshot {
  return {
    v: held.state.v,
    id: held.state.headId,
    docs: held.state.docs,
    meta: held.meta,
    hasDraft: held.state.hasDraft,
    name: held.name,
  };
}

export function changedMeta(
  before: Record<string, PlacementMeta>,
  after: Record<string, PlacementMeta>
): Record<string, PlacementMeta | null> {
  const changes: Record<string, PlacementMeta | null> = {};
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!sameValue(before[id], after[id])) {
      changes[id] = after[id] ?? null;
    }
  }
  return changes;
}

/** A send to a socket that already closed is dropped; one editor's socket never fails another's change. */
export function safeSend(conn: EditorConnection, message: ServerMessage): void {
  try {
    conn.send(message);
  } catch {
    // The socket's close handler unregisters it.
  }
}

/** A retry timer does not keep the process alive on its own. */
export function unref(handle: unknown): void {
  (handle as { unref?: () => void } | null)?.unref?.();
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
