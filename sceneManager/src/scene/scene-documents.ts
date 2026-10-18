import type { CompositionKind } from "@woofx3/api";
import {
  type AckMessage,
  CLOSE_CODES,
  commit,
  createSequencerState,
  decideDuplicate,
  decideWelcome,
  decodeEditorState,
  diffDocuments,
  type EditorState,
  type Entry,
  type EntryRef,
  type ErrorMessage,
  type ExternalBody,
  entryIdOf,
  type ItemBody,
  type MetaChanges,
  type NackMessage,
  nackOf,
  type Ops,
  type PlacementMeta,
  type Plan,
  PROTOCOL_VERSION,
  prepare,
  recordRefusal,
  type SceneDocument,
  type SceneOpsEvent,
  type SceneSnapshot,
  type ServerMessage,
  type Version,
  watermarkOf,
} from "@woofx3/api/scene-editor";
import type { Logger } from "@woofx3/common/runtime";
import type { StreamFrame } from "../../contract/overlay-stream";
import { documentOf, documentsDigest } from "./scene-codec";
import { framingOf, OVERLAY_ORDER, PlacementMetaResolver } from "./placement-meta";
import { SceneWriteback } from "./scene-writeback";
import {
  type EditorConnection,
  editorSnapshotOf,
  errorText,
  type HeldScene,
  type MetaPlan,
  noMeta,
  type ScenePersister,
  type ScenesView,
  safeSend,
  savePending,
  snapshotOf,
  storedDigestOf,
  unreadableColumns,
  unreadableDetail,
  unreadOf,
  unref,
  type VersionView,
  viewOf,
} from "./held-scene";

export type { EditorConnection, ScenePersister, SceneWrite } from "./held-scene";
import { externalMediaUrls } from "../../contract/media-url";
import type { MediaProxy } from "./media-proxy";
import type { EditableScene, OverlaySceneState, OverlayWidgetInstance, SceneVersion } from "./scene-host";

/** The slice of `OverlayHost` the documents load scenes through. */
export interface SceneLoader {
  /** Both versions and the stored editor state from one read; null when the scene does not exist, throws when it cannot be read. */
  loadEditableScene(sceneId: string): Promise<EditableScene | null>;
  loadFramedSceneById(sceneId: string, version?: SceneVersion): Promise<OverlaySceneState | null>;
  /** Placements given as stored, resolved and framed like a loaded scene's. */
  framePlacements(sceneId: string, entries: unknown[]): Promise<OverlayWidgetInstance[]>;
}

export interface SceneBroadcaster {
  broadcast(sceneId: string, frame: StreamFrame): void;
  connectedSceneIds(): string[];
}

/** Time and timers, injected so tests can run the documents on a controlled clock. */
export interface SceneDocumentsClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const SYSTEM_CLOCK: SceneDocumentsClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Standard WebSocket close codes (the IANA registry), for closes no editor needs to tell apart. */
const WS_INTERNAL_ERROR = 1011;
const WS_SERVICE_RESTART = 1012;

/** An editor's opening message, as the documents need it. */
export interface EditorHello {
  clientId: string;
  have: EntryRef | null;
  name: string;
}

export type EditorPresenceUpdate = { selection: string | null; version: Version } | { away: true };

/** The answer to an item that committed no entry; a committed item's answer is its entry. */
export type ItemReply = AckMessage | NackMessage | ErrorMessage;

/** A composition's published document and what it is, as `SceneDocuments.published` gives it. */
export interface PublishedComposition {
  sceneId: string;
  name: string;
  kind: CompositionKind;
  doc: SceneDocument;
}

/** How long after its first unwritten change a scene is written back, at most. */
export const AUTOSAVE_DELAY_MS = 2000;

/**
 * How long after a placement is framed without barkloader's answer it is
 * framed again, doubling on each failure up to `REFRAME_RETRY_MAX_MS`.
 */
export const REFRAME_RETRY_MS = 10_000;
export const REFRAME_RETRY_MAX_MS = 5 * 60_000;

export interface SceneDocumentsOptions {
  persister?: ScenePersister;
  autosaveMs?: number;
  clock?: SceneDocumentsClock;
  /** A fresh epoch for each load of a scene; random by default. */
  newEpoch?: () => string;
  /** First wait before framing again a placement barkloader gave no frame for. */
  reframeRetryMs?: number;
  /** What overlays see of a document: external media pointed at the proxy
   *  for the placements that need it. Overlays see the document as it is
   *  when absent. */
  mediaProxy?: MediaProxy;
}

/**
 * The scene documents of this process, and the scene editor's sequencer.
 *
 * Each scene an overlay or editor opens is held as two documents, the
 * published scene overlays show and the editor's draft, and one scene-wide
 * log of entries (`@woofx3/api/scene-editor` sequencer). Every change, an
 * editor's item or one the engine makes (a workflow step, a save made
 * elsewhere), runs in the scene's serial queue: prepared purely, then, after
 * the placement meta it needs, committed in one synchronous step and sent to
 * every editor as an entry and to every overlay as `scene-ops` for each
 * version it changed. Overlays count their own per-version sequence numbers,
 * so their stream format does not depend on the editor log.
 *
 * Each item gets exactly one terminal answer, decided and sent inside the
 * serial step that decides it: its entry, an `ack` when it committed nothing,
 * or a `nack`; anything that fails before the commit is `nack unavailable`
 * with nothing changed.
 *
 * Documents and editor state (head, entry id, each client's last decided
 * seq) are written back together in one row update, at most
 * `AUTOSAVE_DELAY_MS` after the first unwritten change, and once more on
 * `close()`.
 */
export class SceneDocuments {
  private readonly scenes = new Map<string, HeldScene>();
  private readonly loading = new Map<string, Promise<HeldScene | null>>();
  /** One change at a time per scene, in the order they arrive. */
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly writeback: SceneWriteback;
  private readonly meta: PlacementMetaResolver;
  private readonly clock: SceneDocumentsClock;
  private readonly newEpoch: () => string;
  private readonly reframeRetryMs: number;
  private readonly mediaProxy: MediaProxy | null;
  private closed = false;

  constructor(
    private readonly loader: SceneLoader,
    private readonly broadcaster: SceneBroadcaster,
    private readonly logger: Logger,
    options: SceneDocumentsOptions = {}
  ) {
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.meta = new PlacementMetaResolver(loader, logger);
    this.writeback = new SceneWriteback(
      options.persister ?? null,
      this.clock,
      options.autosaveMs ?? AUTOSAVE_DELAY_MS,
      logger
    );
    this.newEpoch = options.newEpoch ?? (() => crypto.randomUUID());
    this.reframeRetryMs = options.reframeRetryMs ?? REFRAME_RETRY_MS;
    this.mediaProxy = options.mediaProxy ?? null;
  }

  /**
   * The meta of a placement on either version of the scene (published first),
   * or null when it is on neither or the scene does not exist. Searched in the
   * held documents rather than the stored row: pages mount a placement the
   * moment an editor's change reaches them, while the row is written back only
   * after the autosave delay and holds a draft placement only under its draft.
   */
  async placementMeta(sceneId: string, instanceId: string): Promise<PlacementMeta | null> {
    for (const version of ["published", "draft"] as const) {
      const snapshot = await this.snapshot(sceneId, version);
      if (!snapshot) {
        return null;
      }
      if (Object.hasOwn(snapshot.meta, instanceId)) {
        return snapshot.meta[instanceId]!;
      }
    }
    return null;
  }

  /** A version of the scene with its values as entered, loading the scene when it is not held. */
  async snapshot(sceneId: string, version: SceneVersion = "published"): Promise<SceneSnapshot | null> {
    await this.queues.get(sceneId);
    const held = await this.hold(sceneId);
    if (!held) {
      return null;
    }
    // An overlay opening a scene held since its last retry gave up starts
    // the retries again.
    this.scheduleReframe(held);
    return snapshotOf(held, version);
  }

  /**
   * A version of the scene as overlays see it: the snapshot with external
   * media pointed at the proxy where a placement's frame needs it. Editors
   * get the values as entered.
   */
  async overlaySnapshot(sceneId: string, version: SceneVersion = "published"): Promise<SceneSnapshot | null> {
    const snapshot = await this.snapshot(sceneId, version);
    return snapshot && this.mediaProxy ? this.mediaProxy.snapshot(snapshot) : snapshot;
  }

  /**
   * Every external media URL in either version of the scene. Only an editor
   * (through the editor socket) or a save puts a value into these, so this is
   * the set of URLs someone allowed to edit the scene chose, as opposed to
   * whatever a page holding an overlay session sends.
   */
  async editedMediaUrls(sceneId: string): Promise<Set<string>> {
    await this.queues.get(sceneId);
    const held = await this.hold(sceneId);
    const urls = new Set<string>();
    if (!held) {
      return urls;
    }
    for (const doc of [held.state.docs.published, held.state.docs.draft]) {
      for (const placement of Object.values(doc.widgets)) {
        for (const url of externalMediaUrls(placement.settings)) {
          urls.add(url);
        }
      }
    }
    return urls;
  }

  /**
   * A composition's published document and its kind, loading it when it is
   * not held; null when there is no such row. The document is the one
   * overlays and editors have, with live edits not yet written back.
   */
  async published(sceneId: string): Promise<PublishedComposition | null> {
    await this.queues.get(sceneId);
    const held = await this.hold(sceneId);
    if (!held) {
      return null;
    }
    return { sceneId, name: held.name, kind: held.kind, doc: structuredClone(held.state.docs.published) };
  }

  /** The number a version's overlays should be at; 0 when the scene is not held. */
  seqOf(sceneId: string, version: SceneVersion = "published"): number {
    return this.scenes.get(sceneId)?.overlaySeq[version] ?? 0;
  }

  /** Whether the scene's draft differs from what is published. */
  hasDraft(sceneId: string): boolean {
    return this.scenes.get(sceneId)?.state.hasDraft ?? false;
  }

  // ---------------------------------------------------------------------------
  // Editors

  /**
   * An editor said hello: welcome it with the entries it missed or a
   * snapshot, and from then on send it every entry. The welcome and the
   * registration happen in one serial step, so no entry falls between them.
   * A socket already open for the same client is closed as replaced.
   */
  openEditor(sceneId: string, hello: EditorHello, conn: EditorConnection): Promise<void> {
    return this.serial(sceneId, async () => {
      if (this.closed) {
        conn.close(WS_SERVICE_RESTART, "the scene service is restarting");
        return;
      }
      let held: HeldScene | null;
      try {
        held = await this.hold(sceneId);
      } catch (err) {
        this.logger.warn("scene documents: loading a scene for an editor failed", { sceneId, error: errorText(err) });
        conn.close(WS_INTERNAL_ERROR, "the scene could not be loaded");
        return;
      }
      if (!held) {
        safeSend(conn, { type: "error", code: "not_found", detail: "the scene does not exist" });
        conn.close(CLOSE_CODES.notFound, "scene not found");
        return;
      }
      const unreadable = unreadableColumns(held);
      if (unreadable.length > 0) {
        safeSend(conn, { type: "error", code: "not_found", detail: unreadableDetail(unreadable) });
        conn.close(CLOSE_CODES.notFound, "scene could not be read");
        return;
      }
      const existing = held.editors.get(hello.clientId);
      if (existing !== undefined && existing.conn !== conn) {
        held.editors.delete(hello.clientId);
        existing.conn.close(CLOSE_CODES.replaced, "another socket opened for this editor");
      }
      const decision = decideWelcome(held.state, hello.have);
      const base = {
        type: "welcome" as const,
        protocol: PROTOCOL_VERSION as typeof PROTOCOL_VERSION,
        features: [] as string[],
        clientId: hello.clientId,
        last: watermarkOf(held.state, hello.clientId),
      };
      held.editors.set(hello.clientId, { conn, name: hello.name, presence: null, away: false });
      safeSend(
        conn,
        decision.kind === "catchup"
          ? { ...base, catchup: decision.entries }
          : { ...base, snapshot: editorSnapshotOf(held), diverged: decision.diverged }
      );
      for (const [clientId, other] of held.editors) {
        if (clientId !== hello.clientId && other.presence !== null && !other.away) {
          safeSend(conn, { type: "presence", clientId, name: other.name, ...other.presence });
        }
      }
      // An editor now holds this head: store it, so a restart resumes from it.
      if (held.save.storedHeadId !== held.state.headId) {
        this.writeback.markDirty(held);
      }
      this.scheduleReframe(held);
    });
  }

  /**
   * Decide one item from `clientId`, made against entry `base`. Exactly one
   * terminal answer: the committed entry (sent to every editor, the
   * submitter included), or `respond` called once, synchronously inside the
   * serial step, with `ack`, `nack` or a session error.
   */
  submitItem(
    sceneId: string,
    clientId: string,
    seq: number,
    base: number,
    body: ItemBody,
    respond: (reply: ItemReply) => void
  ): Promise<void> {
    return this.serial(sceneId, async () => {
      const src = { clientId, seq };
      let held: HeldScene;
      let plan: Plan;
      let meta: MetaPlan;
      let before: ScenesView;
      let entry: Entry | null;
      try {
        if (this.closed) {
          respond(nackOf(seq, "unavailable", "the scene service is restarting"));
          return;
        }
        const loaded = await this.hold(sceneId);
        if (!loaded) {
          respond({ type: "error", code: "not_found", detail: "the scene does not exist" });
          return;
        }
        held = loaded;
        const duplicate = decideDuplicate(held.state, src);
        if (duplicate !== null) {
          respond(duplicate);
          return;
        }
        const prepared = prepare(held.state, base, body);
        if (prepared.refused) {
          const reply = recordRefusal(held.state, src, prepared, this.clock.now());
          if (!reply.retryable) {
            this.writeback.markDirty(held);
          }
          respond(reply);
          return;
        }
        plan = prepared;
        meta = await this.meta.metaFor(held, plan.docs);
        before = viewOf(held);
        entry = commit(held.state, plan, meta.changes, src, this.clock.now());
      } catch (err) {
        this.logger.warn("scene documents: an item failed before its commit", { sceneId, error: errorText(err) });
        respond(nackOf(seq, "unavailable", "the change could not be made now; it will be retried"));
        return;
      }
      // Committed: from here nothing answers the item but its entry.
      this.afterCommit(held, entry, meta, before);
      if (entry === null) {
        respond({ type: "ack", seq, v: held.state.v });
      }
    });
  }

  /** An editor's presence changed: tell the scene's other editors. */
  editorPresence(
    sceneId: string,
    clientId: string,
    conn: EditorConnection,
    update: EditorPresenceUpdate
  ): Promise<void> {
    return this.serial(sceneId, () => {
      const held = this.scenes.get(sceneId);
      const editor = held?.editors.get(clientId);
      if (held === undefined || editor === undefined || editor.conn !== conn) {
        return;
      }
      if ("away" in update) {
        editor.away = true;
        this.toOtherEditors(held, clientId, { type: "presence", clientId, left: true });
        return;
      }
      editor.away = false;
      editor.presence = { selection: update.selection, version: update.version };
      this.toOtherEditors(held, clientId, { type: "presence", clientId, name: editor.name, ...editor.presence });
    });
  }

  /** An editor's socket closed. A socket already replaced by a newer one for the client changes nothing. */
  closeEditor(sceneId: string, clientId: string, conn: EditorConnection): Promise<void> {
    return this.serial(sceneId, () => {
      const held = this.scenes.get(sceneId);
      const editor = held?.editors.get(clientId);
      if (held === undefined || editor === undefined || editor.conn !== conn) {
        return;
      }
      held.editors.delete(clientId);
      this.toOtherEditors(held, clientId, { type: "presence", clientId, left: true });
    });
  }

  // ---------------------------------------------------------------------------
  // Changes the engine makes

  /**
   * A change the engine makes itself (a workflow step), not an editor:
   * `change` is given the version as it stands and returns the ops to apply,
   * or why it cannot be made. Committed as an `external` entry; a change to
   * the published scene is copied into the draft like a live edit.
   */
  applyChange(
    sceneId: string,
    version: SceneVersion,
    change: (snapshot: SceneSnapshot) => SceneDocumentOps | { error: string }
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.serial(sceneId, async () => {
      // Past close the scenes have been written back for the last time, so a
      // change committed now would be reported made and then lost.
      if (this.closed) {
        return { ok: false as const, error: "unavailable" };
      }
      const held = await this.hold(sceneId);
      if (!held) {
        return { ok: false as const, error: "not_found" };
      }
      const unreadable = unreadableColumns(held);
      if (unreadable.length > 0) {
        return { ok: false as const, error: unreadableDetail(unreadable) };
      }
      const ops = change(snapshotOf(held, version));
      if (!Array.isArray(ops)) {
        return { ok: false as const, error: ops.error };
      }
      const body: ExternalBody = { kind: "external", version, ops, mirrorIntoDraft: version === "published" };
      const plan = prepare(held.state, held.state.v, body);
      if (plan.refused) {
        return { ok: false as const, error: plan.detail };
      }
      const meta = await this.meta.metaFor(held, plan.docs);
      const before = viewOf(held);
      this.afterCommit(held, commit(held.state, plan, meta.changes, null, this.clock.now()), meta, before);
      return { ok: true as const };
    });
  }

  /**
   * The scene was saved. When the save is not this process's own write
   * coming back, commit what changed as an `external` entry, copied into the
   * draft when the scene has none. Document changes this process has not
   * written yet win: their write replaces the save. Never rejects.
   */
  refresh(sceneId: string): Promise<void> {
    return this.serial(sceneId, async () => {
      if (this.closed) {
        return;
      }
      const held = this.scenes.get(sceneId);
      if (!held) {
        // Nobody has it open; the next overlay or editor loads the save.
        return;
      }
      if (this.idle(held)) {
        this.scenes.delete(sceneId);
        return;
      }
      if (held.save.docsDirty) {
        // Changes are waiting to be written; that write supersedes this save.
        return;
      }
      while (held.save.writing !== null) {
        await held.save.writing;
      }
      if (held.save.docsDirty) {
        return;
      }
      const loaded = await this.loader.loadFramedSceneById(sceneId, "published");
      if (!loaded) {
        return;
      }
      held.name = loaded.name;
      held.unread.published = unreadOf(loaded);
      if (!held.state.hasDraft) {
        held.unread.draft = held.unread.published;
      }
      const saved = documentOf(loaded);
      const ops = diffDocuments(held.state.docs.published, saved);
      const body: ExternalBody = {
        kind: "external",
        version: "published",
        ops,
        mirrorIntoDraft: !held.state.hasDraft,
      };
      const plan = prepare(held.state, held.state.v, body);
      if (plan.refused) {
        this.logger.warn("scene documents: a save made elsewhere could not be applied", {
          sceneId,
          detail: plan.detail,
        });
        return;
      }
      const meta = await this.meta.metaFor(held, plan.docs, { knownPublished: framingOf(loaded.instances) });
      const before = viewOf(held);
      this.afterCommit(held, commit(held.state, plan, meta.changes, null, this.clock.now()), meta, before);
      this.takeInInputs(held, saved);
    }).catch((err) => {
      // Callers do not wait on a refresh; the next save or load picks the change up.
      this.logger.warn("scene documents: taking in a save made elsewhere failed", { sceneId, error: errorText(err) });
    });
  }

  /**
   * Inputs are not drafted: both versions declare the ones stored. A save
   * made elsewhere reaches the draft through the published entry only when
   * the scene has no draft, so a scene with one gets the new inputs in an
   * entry of their own.
   */
  private takeInInputs(held: HeldScene, saved: SceneDocument): void {
    const draft = held.state.docs.draft;
    const ops = diffDocuments(draft, { ...draft, inputs: saved.inputs });
    if (ops.length === 0) {
      return;
    }
    const plan = prepare(held.state, held.state.v, {
      kind: "external",
      version: "draft",
      ops,
      mirrorIntoDraft: false,
    });
    if (plan.refused) {
      this.logger.warn("scene documents: stored inputs could not be applied to the draft", {
        sceneId: held.sceneId,
        detail: plan.detail,
      });
      return;
    }
    const before = viewOf(held);
    this.afterCommit(held, commit(held.state, plan, {}, null, this.clock.now()), noMeta(held), before);
  }

  /**
   * Stop taking changes and write back everything not yet written. Called
   * once, on shutdown: items that arrive later are answered `unavailable`
   * (nothing changed), so the editor resends them to the next process.
   */
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.queues.values()]);
    for (const held of this.scenes.values()) {
      if (held.reframe.timer !== null) {
        this.clock.clearTimeout(held.reframe.timer);
        held.reframe.timer = null;
      }
    }
    await this.writeback.flush(this.scenes.values());
  }

  // ---------------------------------------------------------------------------

  /**
   * After a commit: install the meta, tell overlays and editors, and schedule
   * the write and any retry of placements still unframed. `before` is the
   * scene as it stood before the commit. Never throws.
   */
  private afterCommit(held: HeldScene, entry: Entry | null, meta: MetaPlan, before: ScenesView): void {
    held.meta = meta.next;
    held.unframed = meta.unframed;
    if (!held.state.hasDraft) {
      // With no draft the two versions are one, and so are the placements the
      // load could not read: a publish carries the draft's over, and anything
      // else (a discard, a live edit) leaves the published ones. Told apart by
      // the entry, since the documents of a publish and a discard can match.
      if (entry?.kind === "publish") {
        held.unread.published = held.unread.draft;
      } else {
        held.unread.draft = held.unread.published;
      }
    }
    if (entry !== null) {
      this.publishEntry(held, entry, before);
    }
    this.writeback.markDirty(
      held,
      entry !== null && (entry.changes.draft !== undefined || entry.changes.published !== undefined)
    );
    this.scheduleReframe(held);
  }

  private publishEntry(held: HeldScene, entry: Entry, before: ScenesView): void {
    const after = viewOf(held);
    for (const version of OVERLAY_ORDER) {
      const ops = entry.changes[version];
      const meta = entry.meta[version];
      if (ops === undefined && meta === undefined) {
        continue;
      }
      held.overlaySeq[version]++;
      const event: SceneOpsEvent = {
        version,
        seq: held.overlaySeq[version],
        ops: this.overlayOps(ops ?? [], before[version], after[version], meta ?? {}),
        meta: meta ?? {},
      };
      try {
        this.broadcaster.broadcast(held.sceneId, { kind: "scene-ops", event });
      } catch (err) {
        this.logger.warn("scene documents: pushing to overlays failed", {
          sceneId: held.sceneId,
          error: errorText(err),
        });
      }
    }
    const message: ServerMessage = { type: "entry", ...entry };
    for (const editor of held.editors.values()) {
      safeSend(editor.conn, message);
    }
  }

  private toOtherEditors(held: HeldScene, clientId: string, message: ServerMessage): void {
    for (const [otherId, other] of held.editors) {
      if (otherId !== clientId) {
        safeSend(other.conn, message);
      }
    }
  }

  /**
   * The ops that take an overlay's view of `before` to its view of `after`.
   * An overlay holds the document with external media rewritten (see
   * `overlaySnapshot`), so an op on a placement whose view is rewritten,
   * before or after, would mean something else against that view (a splice
   * inside a `url` that is a proxy URL there). Such a placement is sent whole
   * instead, as overlays see it; the ops for every other placement, and for
   * the layout, go out as made. A placement whose meta changed is checked
   * too, since meta decides whether its media is rewritten.
   */
  private overlayOps(ops: Ops, before: VersionView, after: VersionView, metaChanges: MetaChanges): Ops {
    const proxy = this.mediaProxy;
    if (!proxy) {
      return ops;
    }
    const touched = new Set(Object.keys(metaChanges));
    for (const component of ops) {
      if (component.p[0] === "widgets" && typeof component.p[1] === "string") {
        touched.add(component.p[1]);
      }
    }
    const resent = [...touched].filter(
      (id) =>
        proxy.rewrites(before.doc.widgets[id], before.meta[id]) || proxy.rewrites(after.doc.widgets[id], after.meta[id])
    );
    if (resent.length === 0) {
      return ops;
    }
    const replaced = new Set(resent);
    const overlayOps = ops.filter(
      (component) => !(component.p[0] === "widgets" && replaced.has(component.p[1] as string))
    );
    for (const id of resent) {
      const old = before.doc.widgets[id];
      const next = after.doc.widgets[id];
      overlayOps.push({
        p: ["widgets", id],
        ...(old ? { od: proxy.placement(old, before.meta[id]) } : {}),
        ...(next ? { oi: proxy.placement(next, after.meta[id]) } : {}),
      });
    }
    return overlayOps;
  }

  /**
   * Frame again, a while from now, the placements framed without
   * barkloader's answer. Until then such a placement has an unversioned
   * frame URL and no `mediaProxyBase`, while the frame itself may already be
   * served under the theme policy, which blocks its external media. Retries
   * back off to `REFRAME_RETRY_MAX_MS`, and stop once the scene is let go or
   * nobody has it open; an overlay or editor opening it starts them again.
   */
  private scheduleReframe(held: HeldScene): void {
    if (held.reframe.timer !== null || this.closed || this.scenes.get(held.sceneId) !== held) {
      return;
    }
    if (held.unframed.published.size === 0 && held.unframed.draft.size === 0) {
      held.reframe.delayMs = this.reframeRetryMs;
      return;
    }
    const delay = held.reframe.delayMs;
    held.reframe.delayMs = Math.min(delay * 2, REFRAME_RETRY_MAX_MS);
    held.reframe.timer = this.clock.setTimeout(() => {
      held.reframe.timer = null;
      if (this.scenes.get(held.sceneId) !== held || this.idle(held)) {
        return;
      }
      const again = () => this.scheduleReframe(held);
      void this.reframe(held).then(again, again);
    }, delay);
    unref(held.reframe.timer);
  }

  /**
   * Frame the unframed placements of both versions again, and commit the
   * meta that changed as an `external` entry with no ops.
   */
  private reframe(held: HeldScene): Promise<void> {
    return this.serial(held.sceneId, async () => {
      if (this.closed || this.scenes.get(held.sceneId) !== held) {
        return;
      }
      const body: ExternalBody = { kind: "external", version: "published", ops: [], mirrorIntoDraft: false };
      const plan = prepare(held.state, held.state.v, body);
      if (plan.refused) {
        throw new Error(`an external change with no ops was refused: ${plan.detail}`);
      }
      const meta = await this.meta.metaFor(held, plan.docs, { retryUnframed: true });
      const before = viewOf(held);
      this.afterCommit(held, commit(held.state, plan, meta.changes, null, this.clock.now()), meta, before);
    });
  }

  // ---------------------------------------------------------------------------
  // Loading

  private serial<T>(sceneId: string, task: () => Promise<T> | T): Promise<T> {
    const previous = this.queues.get(sceneId) ?? Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.catch((err) => {
      this.logger.warn("scene documents: a change failed", { sceneId, error: errorText(err) });
    });
    this.queues.set(sceneId, settled);
    void settled.finally(() => {
      if (this.queues.get(sceneId) === settled) {
        this.queues.delete(sceneId);
      }
    });
    return run;
  }

  private idle(held: HeldScene): boolean {
    return (
      held.editors.size === 0 && !savePending(held) && !this.broadcaster.connectedSceneIds().includes(held.sceneId)
    );
  }

  private hold(sceneId: string): Promise<HeldScene | null> {
    const held = this.scenes.get(sceneId);
    if (held) {
      return Promise.resolve(held);
    }
    let pending = this.loading.get(sceneId);
    if (!pending) {
      pending = this.load(sceneId).finally(() => this.loading.delete(sceneId));
      this.loading.set(sceneId, pending);
    }
    return pending;
  }

  private async load(sceneId: string): Promise<HeldScene | null> {
    const editable = await this.loader.loadEditableScene(sceneId);
    if (!editable) {
      return null;
    }
    const { published, draft } = editable;
    const docs = { published: documentOf(published), draft: documentOf(draft) };
    const framing = { published: framingOf(published.instances), draft: framingOf(draft.instances) };
    const epoch = this.newEpoch();
    const restored = this.restoredEditorState(sceneId, editable.editorStateJson, docs, epoch);
    const held: HeldScene = {
      sceneId,
      name: published.name,
      kind: published.kind,
      state: createSequencerState({ docs, hasDraft: published.hasDraft === true, editorState: restored.state, epoch }),
      meta: { published: framing.published.meta, draft: framing.draft.meta },
      unframed: { published: framing.published.unframed, draft: framing.draft.unframed },
      reframe: { timer: null, delayMs: this.reframeRetryMs },
      overlaySeq: { published: 0, draft: 0 },
      editors: new Map(),
      save: {
        timer: null,
        dirty: false,
        docsDirty: false,
        writing: null,
        storedHeadId: restored.stored ? restored.state.headId : null,
      },
      unread: { published: unreadOf(published), draft: unreadOf(draft) },
    };
    this.scenes.set(sceneId, held);
    this.scheduleReframe(held);
    return held;
  }

  /**
   * The editor state to resume from. The stored state resumes as it is only
   * when the documents read are the ones it was written with (same digest).
   * Otherwise the documents changed outside the log (a save made elsewhere,
   * or a placement the store does not keep exactly as the editor had it):
   * the head moves one past the stored one, under an id no entry has, so
   * every editor gets a snapshot; editors that were at or behind the stored
   * head rebase onto it quietly, and the watermarks are kept so resent items
   * are still answered once. With no usable stored state (none, cleared by a
   * save made elsewhere, or unreadable) the head starts at 0 under such an
   * id: an editor from an earlier load is told its history diverged.
   */
  private restoredEditorState(
    sceneId: string,
    json: string | null,
    docs: Record<Version, SceneDocument>,
    epoch: string
  ): { state: EditorState; stored: boolean } {
    const decoded = decodeEditorState(json);
    if (!decoded.ok) {
      this.logger.error("scene documents: the stored editor state is unreadable; editors start over", {
        sceneId,
        error: decoded.error,
      });
    }
    if (!decoded.ok || json === null) {
      return { state: { v: 0, headId: entryIdOf(epoch, 0), clients: {} }, stored: false };
    }
    if (storedDigestOf(json) === documentsDigest(docs)) {
      return { state: decoded.state, stored: true };
    }
    this.logger.info("scene documents: the stored documents differ from the editor state's; editors resync", {
      sceneId,
      v: decoded.state.v,
    });
    const v = decoded.state.v + 1;
    return { state: { v, headId: entryIdOf(epoch, v), clients: decoded.state.clients }, stored: false };
  }
}

/** The ops `applyChange` takes. */
type SceneDocumentOps = ExternalBody["ops"];
