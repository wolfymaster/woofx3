import {
  type AckMessage,
  CLOSE_CODES,
  commit,
  createSequencerState,
  decideDuplicate,
  decideWelcome,
  decodeEditorState,
  diffDocuments,
  type EditorSnapshot,
  type EditorState,
  type Entry,
  type EntryRef,
  type ErrorMessage,
  type ExternalBody,
  editorStateOf,
  entryIdOf,
  type ItemBody,
  type MetaChanges,
  type NackMessage,
  nackOf,
  type Ops,
  type PlacementDocument,
  type PlacementMeta,
  type Plan,
  PROTOCOL_VERSION,
  prepare,
  recordRefusal,
  type SceneDocument,
  type SceneOpsEvent,
  type SceneSnapshot,
  type SequencerState,
  type ServerMessage,
  sameValue,
  stackOrder,
  type Version,
  watermarkOf,
  zKey,
} from "@woofx3/api/scene-editor";
import type { Logger } from "@woofx3/common/runtime";
import { externalMediaUrls } from "../../public/scene-manager/media-url";
import { themeOf } from "../../public/scene-manager/scene-update";
import type { MediaProxy } from "./media-proxy";
import type { EditableScene, OverlaySceneState, OverlayWidgetInstance, SceneVersion } from "./scene-host";

/** SSE event carrying a `SceneOpsEvent` to every overlay open on the scene. */
export const SCENE_OPS_EVENT = "scene-ops";

/** The slice of `OverlayHost` the documents load scenes through. */
export interface SceneLoader {
  /** Both versions and the stored editor state from one read; null when the scene does not exist, throws when it cannot be read. */
  loadEditableScene(sceneId: string): Promise<EditableScene | null>;
  loadFramedSceneById(sceneId: string, version?: SceneVersion): Promise<OverlaySceneState | null>;
  /** Placements given as stored, resolved and framed like a loaded scene's. */
  framePlacements(sceneId: string, entries: unknown[]): Promise<OverlayWidgetInstance[]>;
}

/** What the documents write a scene back with; unset fields are left alone. */
export interface SceneWrite {
  id: string;
  widgetsJson?: string;
  layoutJson?: string;
  draftWidgetsJson?: string;
  draftLayoutJson?: string;
  clearDraft?: boolean;
  /** The scene editor's sync state, stored in the same row update as the documents. */
  editorStateJson?: string;
}

/** The slice of the db client the documents write scenes through. */
export interface ScenePersister {
  updateScene(write: SceneWrite): Promise<unknown>;
}

/** The slice of `DeliveryStore` that pushes to a scene's open overlays. */
export interface SceneBroadcaster {
  broadcast(sceneId: string, event: string, data: unknown): void;
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

/** One editor socket, as the documents talk to it. */
export interface EditorConnection {
  send(message: ServerMessage): void;
  close(code: number, reason: string): void;
}

/** An editor's opening message, as the documents need it. */
export interface EditorHello {
  clientId: string;
  have: EntryRef | null;
  name: string;
}

export type EditorPresenceUpdate = { selection: string | null; version: Version } | { away: true };

/** The answer to an item that committed no entry; a committed item's answer is its entry. */
export type ItemReply = AckMessage | NackMessage | ErrorMessage;

/** The fields of a stored placement the document models; the rest go to `extra`. */
const MODELED_FIELDS = new Set([
  "id",
  "widgetCanonicalId",
  "widgetDefinitionRef",
  "name",
  "position",
  "size",
  "rotation",
  "opacity",
  "zIndex",
  "locked",
  "visible",
  "settings",
]);

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** A scene state as a document: placements keyed by id, stacked as saved. */
export function documentOf(state: OverlaySceneState): SceneDocument {
  const widgets: SceneDocument["widgets"] = {};
  state.instances.forEach((instance, index) => {
    const stored = instance.stored ?? {};
    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(stored)) {
      if (!MODELED_FIELDS.has(key)) {
        extra[key] = value;
      }
    }
    widgets[instance.id] = {
      // As stored, so writing the scene back does not rewrite the id.
      widget: typeof stored.widgetCanonicalId === "string" ? stored.widgetCanonicalId : instance.widgetCanonicalId,
      x: instance.position.x,
      y: instance.position.y,
      width: instance.position.width,
      height: instance.position.height,
      visible: instance.visible,
      z: zKey(index),
      settings: instance.settings,
      name: typeof stored.name === "string" ? stored.name : "",
      rotation: numberOr(stored.rotation, 0),
      opacity: numberOr(stored.opacity, 1),
      locked: stored.locked === true,
      extra,
    };
  });
  return { layout: { ...state.layout }, widgets };
}

/**
 * A document in the shapes the database stores and the editor reads:
 * `widgets_json` is the placements in stacking order, each as the editor
 * writes one, and `layout_json` the layout.
 */
export function storedSceneOf(doc: SceneDocument): { widgetsJson: string; layoutJson: string } {
  const widgets = stackOrder(doc).map((id, index) => storedPlacementOf(id, doc.widgets[id]!, index));
  return { widgetsJson: JSON.stringify(widgets), layoutJson: JSON.stringify(doc.layout) };
}

/** One placement as the editor stores it. */
export function storedPlacementOf(id: string, p: PlacementDocument, zIndex: number): Record<string, unknown> {
  return {
    ...p.extra,
    id,
    widgetCanonicalId: p.widget,
    name: p.name,
    position: { x: p.x, y: p.y },
    size: { width: p.width, height: p.height },
    rotation: p.rotation,
    opacity: p.opacity,
    zIndex,
    locked: p.locked,
    visible: p.visible,
    settings: p.settings,
  };
}

/**
 * What each placement of a framed scene state needs beyond the document, and
 * the placements whose frame barkloader did not give.
 */
interface Framing {
  meta: Record<string, PlacementMeta>;
  /** Placement ids framed without barkloader's answer (`OverlayWidgetInstance.frameUnavailable`). */
  unframed: Set<string>;
}

function framingOf(instances: readonly OverlayWidgetInstance[]): Framing {
  const meta: Record<string, PlacementMeta> = {};
  const unframed = new Set<string>();
  for (const instance of instances) {
    meta[instance.id] = placementMetaOf(instance);
    if (instance.frameUnavailable === true && instance.resolved) {
      unframed.add(instance.id);
    }
  }
  return { meta, unframed };
}

function placementMetaOf(instance: OverlayWidgetInstance): PlacementMeta {
  return {
    moduleId: instance.moduleId,
    hostsSurface: instance.hostsSurface,
    frameUrl: instance.frameUrl,
    linkedResources: instance.linkedResources ?? {},
    ...(instance.mediaProxyBase === undefined ? {} : { mediaProxyBase: instance.mediaProxyBase }),
  };
}

/**
 * A digest of both documents that does not depend on key order. Stored with
 * the editor state, so a load can tell whether the documents it read are the
 * ones the stored head describes (see `restoredEditorState`).
 */
export function documentsDigest(docs: Readonly<Record<Version, SceneDocument>>): string {
  return Bun.hash(canonicalJson({ draft: docs.draft, published: docs.published })).toString(36);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** How long after its first unwritten change a scene is written back, at most. */
export const AUTOSAVE_DELAY_MS = 2000;
/**
 * Writes `close()` tries before giving up on a scene, and the wait between
 * them. What is still unwritten then is lost with the process; editors that
 * had it are told so when they reconnect.
 */
export const CLOSE_WRITE_ATTEMPTS = 3;
export const CLOSE_RETRY_MS = 250;
/**
 * How long after a placement is framed without barkloader's answer it is
 * framed again, doubling on each failure up to `REFRAME_RETRY_MAX_MS`.
 */
export const REFRAME_RETRY_MS = 10_000;
export const REFRAME_RETRY_MAX_MS = 5 * 60_000;

/** Version order for overlay events: a live edit reaches overlays before its copy into the draft. */
const OVERLAY_ORDER: readonly Version[] = ["published", "draft"];

interface EditorRecord {
  conn: EditorConnection;
  name: string;
  presence: { selection: string | null; version: Version } | null;
  /** The editor is draining before it closes: hidden from the others. */
  away: boolean;
}

interface SaveState {
  timer: unknown | null;
  /** Something to write (documents or editor state) since the last write began. */
  dirty: boolean;
  /** A document changed since the last write began. */
  docsDirty: boolean;
  writing: Promise<void> | null;
  /** The head the stored editor state names, or null when it names none of this load's. */
  storedHeadId: string | null;
}

interface ReframeState {
  timer: unknown | null;
  /** The wait before the next retry, doubled by each one. */
  delayMs: number;
}

interface HeldScene {
  sceneId: string;
  name: string;
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
}

interface MetaPlan {
  next: Record<Version, Record<string, PlacementMeta>>;
  unframed: Record<Version, Set<string>>;
  changes: Partial<Record<Version, MetaChanges>>;
}

/** A version's document and meta, as they stood before a commit or after it. */
interface VersionView {
  doc: SceneDocument;
  meta: Record<string, PlacementMeta>;
}

type ScenesView = Record<Version, VersionView>;

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
  private readonly persister: ScenePersister | null;
  private readonly autosaveMs: number;
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
    this.persister = options.persister ?? null;
    this.autosaveMs = options.autosaveMs ?? AUTOSAVE_DELAY_MS;
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.newEpoch = options.newEpoch ?? (() => crypto.randomUUID());
    this.reframeRetryMs = options.reframeRetryMs ?? REFRAME_RETRY_MS;
    this.mediaProxy = options.mediaProxy ?? null;
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
        conn.close(1012, "the scene service is restarting");
        return;
      }
      let held: HeldScene | null;
      try {
        held = await this.hold(sceneId);
      } catch (err) {
        this.logger.warn("scene documents: loading a scene for an editor failed", { sceneId, error: errorText(err) });
        conn.close(1011, "the scene could not be loaded");
        return;
      }
      if (!held) {
        safeSend(conn, { type: "error", code: "not_found", detail: "the scene does not exist" });
        conn.close(CLOSE_CODES.notFound, "scene not found");
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
        this.markDirty(held);
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
            this.markDirty(held);
          }
          respond(reply);
          return;
        }
        plan = prepared;
        meta = await this.metaFor(held, plan.docs);
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
      const held = await this.hold(sceneId);
      if (!held) {
        return { ok: false as const, error: "not_found" };
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
      const meta = await this.metaFor(held, plan.docs);
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
      const ops = diffDocuments(held.state.docs.published, documentOf(loaded));
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
      const meta = await this.metaFor(held, plan.docs, { knownPublished: framingOf(loaded.instances) });
      const before = viewOf(held);
      this.afterCommit(held, commit(held.state, plan, meta.changes, null, this.clock.now()), meta, before);
    }).catch((err) => {
      // Callers do not wait on a refresh; the next save or load picks the change up.
      this.logger.warn("scene documents: taking in a save made elsewhere failed", { sceneId, error: errorText(err) });
    });
  }

  /**
   * Stop taking changes and write back everything not yet written. Called
   * once, on shutdown: items that arrive later are answered `unavailable`
   * (nothing changed), so the editor resends them to the next process.
   */
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.queues.values()]);
    await Promise.all(
      [...this.scenes.values()].map(async (held) => {
        if (held.reframe.timer !== null) {
          this.clock.clearTimeout(held.reframe.timer);
          held.reframe.timer = null;
        }
        if (held.save.timer !== null) {
          this.clock.clearTimeout(held.save.timer);
          held.save.timer = null;
        }
        while (held.save.writing !== null) {
          await held.save.writing;
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

  // ---------------------------------------------------------------------------

  /**
   * After a commit: install the meta, tell overlays and editors, and schedule
   * the write and any retry of placements still unframed. `before` is the
   * scene as it stood before the commit. Never throws.
   */
  private afterCommit(held: HeldScene, entry: Entry | null, meta: MetaPlan, before: ScenesView): void {
    held.meta = meta.next;
    held.unframed = meta.unframed;
    if (entry !== null) {
      this.publishEntry(held, entry, before);
    }
    this.markDirty(
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
        this.broadcaster.broadcast(held.sceneId, SCENE_OPS_EVENT, event);
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
   * The meta of each version whose document changes to `docs`. A placement
   * keeps the meta it had in this version, or in the other version after the
   * change, when its widget and theme are the same there; others are framed
   * again. With `retryUnframed`, every unframed placement is framed again
   * too, whether its version changed or not. A placement framing gives no
   * frame for, or that framing fails for, keeps whatever meta it had, or
   * none, and is left to the timed retry (see `scheduleReframe`): meta never
   * fails a change, and an edit never waits on barkloader twice.
   */
  private async metaFor(
    held: HeldScene,
    docs: Readonly<Record<Version, SceneDocument>>,
    options: { knownPublished?: Framing; retryUnframed?: boolean } = {}
  ): Promise<MetaPlan> {
    const next = { ...held.meta };
    const unframed = { ...held.unframed };
    const changes: Partial<Record<Version, MetaChanges>> = {};
    for (const version of OVERLAY_ORDER) {
      const after = docs[version];
      const known = version === "published" ? options.knownPublished : undefined;
      const retry = options.retryUnframed === true ? held.unframed[version] : new Set<string>();
      if (known === undefined && after === held.state.docs[version] && retry.size === 0) {
        continue;
      }
      const other: Version = version === "published" ? "draft" : "published";
      const framing =
        known ??
        (await this.framedMeta(
          held.sceneId,
          after,
          [
            { doc: held.state.docs[version], meta: held.meta[version], unframed: held.unframed[version] },
            { doc: docs[other], meta: next[other], unframed: unframed[other] },
          ],
          retry
        ));
      next[version] = framing.meta;
      unframed[version] = framing.unframed;
      const changed = changedMeta(held.meta[version], next[version]);
      if (Object.keys(changed).length > 0) {
        changes[version] = changed;
      }
    }
    return { next, unframed, changes };
  }

  private async framedMeta(
    sceneId: string,
    after: SceneDocument,
    candidates: ReadonlyArray<VersionView & { unframed: ReadonlySet<string> }>,
    retry: ReadonlySet<string>
  ): Promise<Framing> {
    const meta: Record<string, PlacementMeta> = {};
    const unframed = new Set<string>();
    const reframe: string[] = [];
    for (const [id, placement] of Object.entries(after.widgets)) {
      const same = retry.has(id)
        ? undefined
        : candidates.find((candidate) => {
            const old = candidate.doc.widgets[id];
            return (
              candidate.meta[id] !== undefined &&
              old !== undefined &&
              old.widget === placement.widget &&
              themeOf(old.settings) === themeOf(placement.settings)
            );
          });
      if (same !== undefined) {
        meta[id] = same.meta[id]!;
        if (same.unframed.has(id)) {
          unframed.add(id);
        }
      } else {
        reframe.push(id);
      }
    }
    if (reframe.length === 0) {
      return { meta, unframed };
    }
    const order = stackOrder(after);
    const entries = reframe.map((id) => storedPlacementOf(id, after.widgets[id]!, order.indexOf(id)));
    try {
      const wanted = new Set(reframe);
      const framing = framingOf(
        (await this.loader.framePlacements(sceneId, entries)).filter((instance) => wanted.has(instance.id))
      );
      Object.assign(meta, framing.meta);
      for (const id of framing.unframed) {
        unframed.add(id);
      }
    } catch (err) {
      this.logger.warn("scene documents: framing placements failed; they keep their meta", {
        sceneId,
        placements: reframe.length,
        error: errorText(err),
      });
      for (const id of reframe) {
        const kept = candidates.find((candidate) => candidate.meta[id] !== undefined);
        if (kept !== undefined) {
          meta[id] = kept.meta[id]!;
        }
        unframed.add(id);
      }
    }
    return { meta, unframed };
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
      const meta = await this.metaFor(held, plan.docs, { retryUnframed: true });
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

  // ---------------------------------------------------------------------------
  // Writing back

  /** Something changed: write the scene back, at most `autosaveMs` from now. */
  private markDirty(held: HeldScene, docsChanged = false): void {
    held.save.dirty = true;
    held.save.docsDirty = held.save.docsDirty || docsChanged;
    this.scheduleWrite(held);
  }

  private scheduleWrite(held: HeldScene): void {
    if (this.persister === null || held.save.timer !== null || held.save.writing !== null || this.closed) {
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
    if (this.persister === null || held.save.writing !== null) {
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
      this.scheduleWrite(held);
    }
  }
}

/** The ops `applyChange` takes. */
type SceneDocumentOps = ExternalBody["ops"];

function savePending(held: HeldScene): boolean {
  return held.save.dirty || held.save.timer !== null || held.save.writing !== null;
}

function sceneWriteOf(held: HeldScene, now: number): SceneWrite {
  const { docs, hasDraft } = held.state;
  const published = storedSceneOf(docs.published);
  const draft = hasDraft
    ? (() => {
        const stored = storedSceneOf(docs.draft);
        return { draftWidgetsJson: stored.widgetsJson, draftLayoutJson: stored.layoutJson };
      })()
    : { clearDraft: true };
  const editorState = { ...editorStateOf(held.state, now), digest: documentsDigest(docs) };
  return {
    id: held.sceneId,
    widgetsJson: published.widgetsJson,
    layoutJson: published.layoutJson,
    ...draft,
    editorStateJson: JSON.stringify(editorState),
  };
}

/** The digest stored beside the sequencer's fields, or null when there is none. */
function storedDigestOf(json: string): string | null {
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

function snapshotOf(held: HeldScene, version: Version): SceneSnapshot {
  return {
    sceneId: held.sceneId,
    name: held.name,
    seq: held.overlaySeq[version],
    doc: held.state.docs[version],
    meta: held.meta[version],
  };
}

function viewOf(held: HeldScene): ScenesView {
  return {
    published: { doc: held.state.docs.published, meta: held.meta.published },
    draft: { doc: held.state.docs.draft, meta: held.meta.draft },
  };
}

function editorSnapshotOf(held: HeldScene): EditorSnapshot {
  return {
    v: held.state.v,
    id: held.state.headId,
    docs: held.state.docs,
    meta: held.meta,
    hasDraft: held.state.hasDraft,
    name: held.name,
  };
}

function changedMeta(
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
function safeSend(conn: EditorConnection, message: ServerMessage): void {
  try {
    conn.send(message);
  } catch {
    // The socket's close handler unregisters it.
  }
}

/** A retry timer does not keep the process alive on its own. */
function unref(handle: unknown): void {
  (handle as { unref?: () => void } | null)?.unref?.();
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
