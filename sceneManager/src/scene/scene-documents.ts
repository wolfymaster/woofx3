import type { Logger } from "@woofx3/common/runtime";
import { parsePlacementTransition } from "@woofx3/module-sdk";
// The document is the page's wire format, so it lives with the page.
import {
  type Json0Component,
  type PlacementDocument,
  type PlacementMeta,
  type SceneDocument,
  type SceneOpsEvent,
  type SceneSnapshot,
  applyOps,
  diffDocuments,
  stackOrder,
  transformOps,
  transitionsOf,
  zKey,
} from "../../public/scene-manager/scene-document";
import { sameValue, themeOf } from "../../public/scene-manager/scene-update";
import type { OverlaySceneState, OverlayWidgetInstance, SceneVersion } from "./scene-host";

/** SSE event carrying a `SceneOpsEvent` to every overlay open on the scene. */
export const SCENE_OPS_EVENT = "scene-ops";

/** The slice of `OverlayHost` the documents load scenes through. */
export interface SceneLoader {
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
  "transitionIn",
  "transitionOut",
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
      ...transitionsOf(instance),
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
    ...transitionsOf(p),
  };
}

/** What each placement of a framed scene state needs beyond the document. */
export function metaOf(state: OverlaySceneState): Record<string, PlacementMeta> {
  const meta: Record<string, PlacementMeta> = {};
  for (const instance of state.instances) {
    meta[instance.id] = {
      moduleId: instance.moduleId,
      hostsSurface: instance.hostsSurface,
      frameUrl: instance.frameUrl,
      linkedResources: instance.linkedResources ?? {},
      ...(instance.widgetTransitions ? { widgetTransitions: instance.widgetTransitions } : {}),
    };
  }
  return meta;
}

/** How long a version waits after its last change before it is written back. */
export const AUTOSAVE_DELAY_MS = 2000;
/** Recent ops kept per version to transform a late editor's ops against. */
export const OP_LOG_LIMIT = 500;
/** Largest ops one submit may carry, and largest a document may grow. */
export const MAX_OPS_BYTES = 64 * 1024;
export const MAX_DOCUMENT_BYTES = 1024 * 1024;

type RequiredPlacementField = Exclude<keyof PlacementDocument, OptionalPlacementField>;
type OptionalPlacementField = "transitionIn" | "transitionOut";

const PLACEMENT_FIELDS: Record<RequiredPlacementField, (value: unknown) => boolean> = {
  widget: (v) => typeof v === "string" && v.length > 0 && v.length <= 256,
  x: isFiniteNumber,
  y: isFiniteNumber,
  width: (v) => isFiniteNumber(v) && v >= 0,
  height: (v) => isFiniteNumber(v) && v >= 0,
  visible: (v) => typeof v === "boolean",
  z: (v) => typeof v === "string" && v.length > 0 && v.length <= 64,
  settings: isPlainObject,
  name: (v) => typeof v === "string" && v.length <= 256,
  rotation: isFiniteNumber,
  opacity: (v) => isFiniteNumber(v) && v >= 0 && v <= 1,
  locked: (v) => typeof v === "boolean",
  extra: isPlainObject,
};

/** Fields a placement may leave out; absent means none. */
const OPTIONAL_PLACEMENT_FIELDS: Record<OptionalPlacementField, (value: unknown) => boolean> = {
  transitionIn: (v) => parsePlacementTransition(v).ok,
  transitionOut: (v) => parsePlacementTransition(v).ok,
};

function placementFieldCheck(field: string): ((value: unknown) => boolean) | null {
  if (Object.hasOwn(PLACEMENT_FIELDS, field)) {
    return PLACEMENT_FIELDS[field as RequiredPlacementField];
  }
  if (Object.hasOwn(OPTIONAL_PLACEMENT_FIELDS, field)) {
    return OPTIONAL_PLACEMENT_FIELDS[field as OptionalPlacementField];
  }
  return null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlacement(value: unknown): value is PlacementDocument {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    Object.entries(PLACEMENT_FIELDS).every(([field, valid]) => valid(value[field])) &&
    Object.entries(value).every(([field, fieldValue]) => placementFieldCheck(field)?.(fieldValue) === true)
  );
}

/**
 * Why an editor's ops may not be applied, or null when they may: every path
 * stays inside the layout or a placement, a placement inserted whole is
 * complete, and a placement's own fields keep their types. Settings and
 * layout values are the widget's and the editor's business.
 */
export function invalidOps(ops: unknown): string | null {
  if (!Array.isArray(ops) || ops.length === 0) {
    return "ops must be a non-empty list";
  }
  if (JSON.stringify(ops).length > MAX_OPS_BYTES) {
    return "ops too large";
  }
  for (const component of ops) {
    if (!isPlainObject(component) || !Array.isArray(component.p) || component.p.length === 0) {
      return "every op needs a path";
    }
    const p = component.p as unknown[];
    if (!p.every((segment) => typeof segment === "string" || (typeof segment === "number" && segment >= 0))) {
      return "a path is made of keys and indexes";
    }
    if (p[0] === "layout") {
      continue;
    }
    if (p[0] !== "widgets" || p.length < 2 || typeof p[1] !== "string" || p[1].length === 0 || p[1].length > 128) {
      return "a path must start at the layout or a placement";
    }
    if (p.length === 2) {
      if ("oi" in component && !isPlacement(component.oi)) {
        return "a placement must be inserted whole";
      }
      continue;
    }
    const field = p[2];
    const check = typeof field === "string" ? placementFieldCheck(field) : null;
    if (check === null) {
      return `a placement has no field ${String(field)}`;
    }
    if (p.length === 3 && "oi" in component && !check(component.oi)) {
      return `invalid ${field}`;
    }
  }
  return null;
}

/**
 * Why `doc`, the result of applying `ops`, may not be kept, or null when it
 * may. `invalidOps` checks a value set whole; an op inside a transition (a
 * new duration) can only be judged by the transition it leaves behind.
 */
export function invalidResult(doc: SceneDocument, ops: readonly Json0Component[]): string | null {
  for (const component of ops) {
    const [root, id, field] = component.p;
    if (root !== "widgets" || typeof id !== "string" || typeof field !== "string" || component.p.length <= 3) {
      continue;
    }
    if (!Object.hasOwn(OPTIONAL_PLACEMENT_FIELDS, field)) {
      continue;
    }
    const placement = doc.widgets[id] as unknown as Record<string, unknown> | undefined;
    const value = placement?.[field];
    if (value !== undefined && !OPTIONAL_PLACEMENT_FIELDS[field as OptionalPlacementField](value)) {
      return `invalid ${field}`;
    }
  }
  return null;
}

/** The SSE and editor push for one version's change. */
export interface VersionedOpsEvent extends SceneOpsEvent {
  version: SceneVersion;
  /** The submitting editor's op id, so it knows the op as its own; null otherwise. */
  opId: string | null;
}

export type EditorListener = (event: VersionedOpsEvent) => void;

export type SubmitResult =
  | { ok: true; seq: number }
  | { ok: false; error: "not_found" | "resync" | "invalid"; detail?: string };

interface HeldVersion {
  snapshot: SceneSnapshot;
  /** The most recent ops, oldest first, for transforming late submits, with
   *  the op id each was submitted under, to know a resubmit. */
  log: Array<{ seq: number; ops: Json0Component[]; opId: string | null }>;
  saveTimer: ReturnType<typeof setTimeout> | null;
  /** The document last written back, to know the database's echo of it. */
  written: SceneDocument | null;
}

interface HeldScene {
  published: HeldVersion;
  draft: HeldVersion;
  /** Whether the draft differs from the published scene in storage. */
  hasDraft: boolean;
  editors: Set<EditorListener>;
}

export interface SceneDocumentsOptions {
  persister?: ScenePersister;
  autosaveMs?: number;
}

/**
 * The scene documents of this process, and their sequencer.
 *
 * Each scene an overlay or editor opens is held as two documents, the
 * published scene overlays show and the editor's draft, each with its own
 * sequence number. Every change to either, whether an editor's ops or a save
 * made elsewhere, is applied here one at a time, stamped with that version's
 * next number and pushed to its overlays (SSE `scene-ops`) and its editors.
 *
 * An editor's ops name the number they were made against; ops applied since
 * are transformed in first (json0), so concurrent editors converge. Edits to
 * the published scene (live editing) are copied into the draft field by
 * field, so a later publish cannot undo them. Each version is written back
 * to the database a moment after its last change, and the database's echo of
 * that write is recognised and ignored.
 */
export class SceneDocuments {
  private readonly scenes = new Map<string, HeldScene>();
  private readonly loading = new Map<string, Promise<HeldScene | null>>();
  /** One change at a time per scene, in the order they arrive. */
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly persister: ScenePersister | null;
  private readonly autosaveMs: number;

  constructor(
    private readonly loader: SceneLoader,
    private readonly broadcaster: SceneBroadcaster,
    private readonly logger: Logger,
    options: SceneDocumentsOptions = {}
  ) {
    this.persister = options.persister ?? null;
    this.autosaveMs = options.autosaveMs ?? AUTOSAVE_DELAY_MS;
  }

  /** A version of the scene as it stands, loading the scene when it is not held. */
  async snapshot(sceneId: string, version: SceneVersion = "published"): Promise<SceneSnapshot | null> {
    await this.queues.get(sceneId);
    const held = await this.hold(sceneId);
    return held ? held[version].snapshot : null;
  }

  /** The number a version's overlays should be at; 0 when the scene is not held. */
  seqOf(sceneId: string, version: SceneVersion = "published"): number {
    return this.scenes.get(sceneId)?.[version].snapshot.seq ?? 0;
  }

  /** Whether the scene's draft differs from what is published. */
  hasDraft(sceneId: string): boolean {
    return this.scenes.get(sceneId)?.hasDraft ?? false;
  }

  /** Hear every change to the scene; null when it does not load. */
  async subscribeEditor(sceneId: string, listener: EditorListener): Promise<(() => void) | null> {
    const held = await this.hold(sceneId);
    if (!held) {
      return null;
    }
    held.editors.add(listener);
    return () => {
      held.editors.delete(listener);
    };
  }

  /** Apply an editor's ops, made against `base`, to a version of the scene. */
  submit(
    sceneId: string,
    version: SceneVersion,
    base: number,
    ops: unknown,
    opId: string | null = null
  ): Promise<SubmitResult> {
    return this.serial(sceneId, async (): Promise<SubmitResult> => {
      const invalid = invalidOps(ops);
      if (invalid) {
        return { ok: false, error: "invalid", detail: invalid };
      }
      const held = await this.hold(sceneId);
      if (!held) {
        return { ok: false, error: "not_found" };
      }
      const target = held[version];
      const seq = target.snapshot.seq;
      // An editor that reconnects resends what it has no ack for; ops this
      // already applied are acknowledged, not applied twice.
      const applied = opId === null ? undefined : target.log.find((entry) => entry.opId === opId);
      if (applied) {
        return { ok: true, seq: applied.seq };
      }
      if (!Number.isInteger(base) || base > seq) {
        return { ok: false, error: "resync", detail: "base is ahead of the scene" };
      }
      const missed = target.log.filter((entry) => entry.seq > base);
      if (missed.length !== seq - base) {
        return { ok: false, error: "resync", detail: "base is older than the ops kept" };
      }
      let transformed = ops as Json0Component[];
      try {
        for (const entry of missed) {
          transformed = transformOps(transformed, entry.ops, "left");
        }
      } catch (err) {
        return { ok: false, error: "invalid", detail: `ops do not transform: ${String(err)}` };
      }
      if (transformed.length === 0) {
        return { ok: true, seq };
      }
      const failure = await this.apply(held, version, transformed, opId);
      if (failure) {
        return { ok: false, error: "invalid", detail: failure };
      }
      return { ok: true, seq: held[version].snapshot.seq };
    });
  }

  /**
   * A change the engine makes itself (a workflow step), not an editor:
   * `change` is given the version as it stands and returns the ops to apply,
   * or why it cannot be made. Applied, pushed and saved like an editor's.
   */
  applyChange(
    sceneId: string,
    version: SceneVersion,
    change: (snapshot: SceneSnapshot) => Json0Component[] | { error: string }
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.serial(sceneId, async () => {
      const held = await this.hold(sceneId);
      if (!held) {
        return { ok: false as const, error: "not_found" };
      }
      const ops = change(held[version].snapshot);
      if (!Array.isArray(ops)) {
        return { ok: false as const, error: ops.error };
      }
      if (ops.length === 0) {
        return { ok: true as const };
      }
      const invalid = invalidOps(ops);
      const failure = invalid ?? (await this.apply(held, version, ops, null));
      return failure ? { ok: false as const, error: failure } : { ok: true as const };
    });
  }

  /** Apply ops made against a version as it stands; why not, or null. */
  private async apply(
    held: HeldScene,
    version: SceneVersion,
    ops: Json0Component[],
    opId: string | null
  ): Promise<string | null> {
    let doc: SceneDocument;
    try {
      doc = applyOps(held[version].snapshot.doc, ops);
    } catch (err) {
      return `ops do not apply: ${String(err)}`;
    }
    const invalid = invalidResult(doc, ops);
    if (invalid) {
      return invalid;
    }
    if (JSON.stringify(doc).length > MAX_DOCUMENT_BYTES) {
      return "the scene would be too large";
    }
    // Before the commit, so the change goes out saying the draft exists.
    if (version === "draft") {
      held.hasDraft = true;
    }
    await this.commit(held, version, ops, doc, opId);
    if (version === "published") {
      await this.mirrorIntoDraft(held, ops);
    }
    return null;
  }

  /** Make the draft the published scene. */
  publish(sceneId: string): Promise<boolean> {
    return this.serial(sceneId, async () => {
      const held = await this.hold(sceneId);
      if (!held) {
        return false;
      }
      const ops = diffDocuments(held.published.snapshot.doc, held.draft.snapshot.doc);
      if (ops.length > 0) {
        await this.commit(held, "published", ops, held.draft.snapshot.doc, null, false);
      }
      await this.settle(held, { clearDraft: true, published: true });
      return true;
    });
  }

  /** Throw the draft away: it becomes the published scene again. */
  discard(sceneId: string): Promise<boolean> {
    return this.serial(sceneId, async () => {
      const held = await this.hold(sceneId);
      if (!held) {
        return false;
      }
      const ops = diffDocuments(held.draft.snapshot.doc, held.published.snapshot.doc);
      if (ops.length > 0) {
        await this.commit(held, "draft", ops, held.published.snapshot.doc, null, false);
      }
      await this.settle(held, { clearDraft: true, published: false });
      return true;
    });
  }

  /**
   * The scene was saved. When the save is not this process's own write
   * coming back, push what changed to the scene's overlays and editors.
   */
  refresh(sceneId: string): Promise<void> {
    return this.serial(sceneId, async () => {
      const held = this.scenes.get(sceneId);
      if (!held) {
        // Nobody has it open; the next overlay or editor loads the save.
        return;
      }
      if (this.idle(sceneId, held)) {
        this.scenes.delete(sceneId);
        return;
      }
      if (held.published.saveTimer !== null) {
        // Edits are waiting to be written; that write supersedes this save.
        return;
      }
      const state = await this.loader.loadFramedSceneById(sceneId, "published");
      if (!state) {
        return;
      }
      const doc = documentOf(state);
      if (held.published.written && sameValue(doc, held.published.written)) {
        return;
      }
      const ops = diffDocuments(held.published.snapshot.doc, doc);
      const metaChanges = changedMeta(held.published.snapshot.meta, metaOf(state));
      if (ops.length === 0 && Object.keys(metaChanges).length === 0) {
        return;
      }
      await this.commit(held, "published", ops, doc, null, false, metaOf(state), state.name);
      held.published.written = doc;
      if (!held.hasDraft) {
        await this.mirrorIntoDraft(held, ops);
      }
    }).then(() => undefined);
  }

  /** Write back every change still waiting to be written. */
  async flush(): Promise<void> {
    await Promise.all(
      [...this.scenes.entries()].flatMap(([, held]) =>
        (["published", "draft"] as const).map((version) => {
          const timer = held[version].saveTimer;
          if (timer === null) {
            return Promise.resolve();
          }
          clearTimeout(timer);
          held[version].saveTimer = null;
          return this.persist(held, version);
        })
      )
    );
  }

  // ---------------------------------------------------------------------------

  private serial<T>(sceneId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(sceneId) ?? Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.catch((err) => {
      this.logger.warn("scene documents: a change failed", {
        sceneId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    this.queues.set(sceneId, settled);
    void settled.finally(() => {
      if (this.queues.get(sceneId) === settled) {
        this.queues.delete(sceneId);
      }
    });
    return run;
  }

  private idle(sceneId: string, held: HeldScene): boolean {
    return (
      held.editors.size === 0 &&
      held.published.saveTimer === null &&
      held.draft.saveTimer === null &&
      !this.broadcaster.connectedSceneIds().includes(sceneId)
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
    const [published, draft] = await Promise.all([
      this.loader.loadFramedSceneById(sceneId, "published"),
      this.loader.loadFramedSceneById(sceneId, "draft"),
    ]);
    if (!published || !draft) {
      return null;
    }
    const version = (state: OverlaySceneState): HeldVersion => ({
      snapshot: { sceneId, name: state.name, seq: 0, doc: documentOf(state), meta: metaOf(state) },
      log: [],
      saveTimer: null,
      written: null,
    });
    const held: HeldScene = {
      published: version(published),
      draft: version(draft),
      hasDraft: published.hasDraft === true,
      editors: new Set(),
    };
    this.scenes.set(sceneId, held);
    return held;
  }

  /**
   * Stamp a version's change with its next number, keep it, and push it.
   * Meta is worked out again for placements that are new, or whose widget or
   * theme changed, unless the caller already knows it.
   */
  private async commit(
    held: HeldScene,
    version: SceneVersion,
    ops: Json0Component[],
    doc: SceneDocument,
    opId: string | null,
    autosave = true,
    knownMeta?: Record<string, PlacementMeta>,
    name?: string
  ): Promise<void> {
    const target = held[version];
    const before = target.snapshot;
    const meta = knownMeta ?? (await this.metaFor(before.sceneId, before.doc, doc, before.meta));
    const metaChanges = changedMeta(before.meta, meta);
    const seq = before.seq + 1;
    target.snapshot = { ...before, name: name ?? before.name, seq, doc, meta };
    target.log.push({ seq, ops, opId });
    if (target.log.length > OP_LOG_LIMIT) {
      target.log.splice(0, target.log.length - OP_LOG_LIMIT);
    }
    const event: VersionedOpsEvent = { version, seq, ops, meta: metaChanges, opId };
    this.broadcaster.broadcast(before.sceneId, SCENE_OPS_EVENT, {
      version,
      seq,
      ops,
      meta: metaChanges,
    } satisfies SceneOpsEvent);
    for (const listener of held.editors) {
      try {
        listener(event);
      } catch (err) {
        this.logger.warn("scene documents: an editor listener threw", {
          sceneId: before.sceneId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (autosave) {
      this.scheduleSave(held, version);
    }
  }

  private async metaFor(
    sceneId: string,
    before: SceneDocument,
    after: SceneDocument,
    meta: Record<string, PlacementMeta>
  ): Promise<Record<string, PlacementMeta>> {
    const next: Record<string, PlacementMeta> = {};
    const reframe: string[] = [];
    for (const [id, placement] of Object.entries(after.widgets)) {
      const old = before.widgets[id];
      if (
        !meta[id] ||
        !old ||
        old.widget !== placement.widget ||
        themeOf(old.settings) !== themeOf(placement.settings)
      ) {
        reframe.push(id);
      } else {
        next[id] = meta[id]!;
      }
    }
    if (reframe.length > 0) {
      const order = stackOrder(after);
      const entries = reframe.map((id) => storedPlacementOf(id, after.widgets[id]!, order.indexOf(id)));
      for (const instance of await this.loader.framePlacements(sceneId, entries)) {
        next[instance.id] = {
          moduleId: instance.moduleId,
          hostsSurface: instance.hostsSurface,
          frameUrl: instance.frameUrl,
          linkedResources: instance.linkedResources ?? {},
        };
      }
    }
    return next;
  }

  /**
   * Copy what published ops changed into the draft, field by field: a live
   * edit wins over the draft's own value for that field, and the draft keeps
   * every other edit it has.
   */
  private async mirrorIntoDraft(held: HeldScene, ops: Json0Component[]): Promise<void> {
    const published = held.published.snapshot.doc;
    const current = held.draft.snapshot.doc;
    const target: SceneDocument = structuredClone(current);
    for (const component of ops) {
      const [root, id, field] = component.p;
      if (root === "layout") {
        target.layout = structuredClone(published.layout);
        continue;
      }
      if (root !== "widgets" || typeof id !== "string") {
        continue;
      }
      const live = published.widgets[id];
      if (!live) {
        delete target.widgets[id];
      } else if (typeof field !== "string" || !target.widgets[id]) {
        target.widgets[id] = structuredClone(live);
      } else {
        (target.widgets[id] as unknown as Record<string, unknown>)[field] = structuredClone(
          (live as unknown as Record<string, unknown>)[field]
        );
      }
    }
    const draftOps = diffDocuments(current, target);
    if (draftOps.length > 0) {
      await this.commit(held, "draft", draftOps, target, null, held.hasDraft);
    }
  }

  private scheduleSave(held: HeldScene, version: SceneVersion): void {
    // A draft with nothing of its own is written as no draft (see persist).
    if (!this.persister) {
      return;
    }
    const target = held[version];
    if (target.saveTimer !== null) {
      clearTimeout(target.saveTimer);
    }
    target.saveTimer = setTimeout(() => {
      target.saveTimer = null;
      void this.serial(target.snapshot.sceneId, () => this.persist(held, version));
    }, this.autosaveMs);
  }

  private async persist(held: HeldScene, version: SceneVersion): Promise<void> {
    if (!this.persister) {
      return;
    }
    const { sceneId, doc } = held[version].snapshot;
    const stored = storedSceneOf(doc);
    const write: SceneWrite =
      version === "published"
        ? { id: sceneId, widgetsJson: stored.widgetsJson, layoutJson: stored.layoutJson }
        : held.hasDraft
          ? { id: sceneId, draftWidgetsJson: stored.widgetsJson, draftLayoutJson: stored.layoutJson }
          : { id: sceneId, clearDraft: true };
    try {
      await this.persister.updateScene(write);
      held[version].written = structuredClone(doc);
    } catch (err) {
      this.logger.warn("scene documents: writing a scene back failed", {
        sceneId,
        version,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** After a publish or discard: no draft, written at once, nothing pending. */
  private async settle(held: HeldScene, how: { clearDraft: true; published: boolean }): Promise<void> {
    for (const version of ["published", "draft"] as const) {
      const timer = held[version].saveTimer;
      if (timer !== null) {
        clearTimeout(timer);
        held[version].saveTimer = null;
      }
    }
    held.hasDraft = false;
    if (!this.persister) {
      return;
    }
    const { sceneId, doc } = held.published.snapshot;
    const stored = storedSceneOf(doc);
    try {
      await this.persister.updateScene({
        id: sceneId,
        clearDraft: how.clearDraft,
        ...(how.published ? { widgetsJson: stored.widgetsJson, layoutJson: stored.layoutJson } : {}),
      });
      if (how.published) {
        held.published.written = structuredClone(doc);
      }
    } catch (err) {
      this.logger.warn("scene documents: writing a publish or discard failed", {
        sceneId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
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
