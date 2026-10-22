// The headless composition editor: everything a scene or alert editor does
// that is not drawing. A UI renders `getState()`, forwards pointer and key
// input as gestures and commands, and calls the node and behavior methods
// from its panels; this module does the geometry, the document changes and
// the history.
//
// State is a plain, immutable snapshot. `getState()` returns the same object
// until something in it changes, and each part (the view's nodes, the
// selection, the guides) keeps its identity while unchanged, so React's
// `useSyncExternalStore` and memoized children re-render only what moved.
//
// Two kinds of change, kept apart:
// - Transient: a gesture in progress. Updates change only `transient` and
//   the view, as often as the pointer moves; the document is not touched.
// - Committed: one `source.apply` per user action. A whole drag is one
//   commit when the pointer is released, so it is one undo and one op on
//   the wire.
//
// The editor never mutates the document it is handed; every change goes
// through the source as a function of the document as it stands.

import { ALERT_SURFACE, alertWidgetName, nextAlertWidgetName } from "../model/alert-names";
import { assert, isCompositionShape, sameValue, withoutWidget } from "../model/composition";
import { keyAt, keyBetween, keysBetween, orderByKey, stackOrder } from "../model/keys";
import { TOLERANT_REGISTRY, type TypeRegistry } from "../model/registry";
import { mediaLengthEstimates, type ResolvedTimeline, resolveTimeline } from "../model/timeline";
import {
  type AnchorKind,
  type BehaviorDocument,
  type BehaviorId,
  CANVAS_TARGET,
  type CompositionDocument,
  type CompositionProfile,
  type NodeId,
  type PlacementDocument,
  type Timing,
} from "../model/types";
import {
  type CatalogWidget,
  canvasSizeOf,
  NODE_ID_PATTERN,
  newPlacement,
  placeableOn,
  randomNodeId,
  type WidgetKind,
  widgetKind,
} from "./catalog";
import {
  type Box,
  type CanvasSize,
  centerOf,
  clampCenter,
  DEFAULT_ZOOM,
  FIT_PADDING,
  fitZoom,
  type Guide,
  MIN_NODE_SIZE,
  type Point,
  type ResizeHandle,
  resizeBox,
  rotationAt,
  SNAP_DISTANCE,
  SNAP_DISTANCE_TOUCH,
  type SnapTargets,
  snapBox,
  snapResize,
  snapTargets,
  textBoxHeight,
  withCenter,
  zoomIn,
  zoomOut,
} from "./geometry";
import { EditHistory } from "./history";
import {
  bindingFor,
  COMMAND_IDS,
  type CommandId,
  chordOf,
  DEFAULT_KEYMAP,
  type KeyBinding,
  type KeyInput,
} from "./keymap";
import { applyCompositionOps, diffCompositions, type Ops } from "./ops";
import { buildPreviewLayoutMessage, type PreviewFrame, type PreviewLayoutMessage } from "./preview";
import type { ApplyResult, DocumentSource, Peer } from "./source";

export interface CompositionEditorOptions {
  source: DocumentSource;
  profile: CompositionProfile;
  /** The installed widgets; only those placeable on the profile's surface are offered. */
  catalog: readonly CatalogWidget[];
  /**
   * Checks every change before it is committed, gives new behaviors their
   * defaults, and says how each widget's box is edited. Defaults to the
   * tolerant registry, as a client keeps what a newer engine wrote; the
   * engine still checks each change strictly.
   */
  registry?: TypeRegistry;
  /** Defaults to `DEFAULT_KEYMAP`. */
  keymap?: readonly KeyBinding[];
  /** Milliseconds, for coalescing edits into one undo. Defaults to `Date.now`. */
  now?: () => number;
  /** A fresh placement id not in `taken`. Defaults to a random `w-` id; must match `NODE_ID_PATTERN`. */
  newNodeId?: (taken: ReadonlySet<string>) => string;
  /** A fresh behavior id not in `taken`. Defaults to a random `b-` id. */
  newBehaviorId?: (taken: ReadonlySet<string>) => string;
}

/** One placement as the canvas shows it. */
export interface NodeView {
  id: NodeId;
  placement: PlacementDocument;
  /** Where the canvas draws it: the placement's box, or the gesture's while one moves it. */
  box: Box;
  kind: WidgetKind;
  selected: boolean;
  /** A gesture in progress is moving this node. */
  transient: boolean;
  /** Resizing keeps its aspect unless Shift is held. */
  keepsAspect: boolean;
}

export interface ViewState {
  /** The canvas size, or null before the document loads. */
  canvas: CanvasSize | null;
  /** Bottom of the stack first. */
  nodes: readonly NodeView[];
}

export interface SelectionState {
  ids: readonly NodeId[];
  /** The node the inspector shows: the one selected last. */
  primary: NodeId | null;
}

export type GestureKind = "move" | "resize" | "rotate";

export interface TransientState {
  gesture: GestureKind;
  /** The boxes the gesture has moved its nodes to so far. */
  boxes: Readonly<Record<NodeId, Box>>;
}

export interface ViewportState {
  zoom: number;
  /** Zoom follows the stage size (Fit) rather than a level the user picked. */
  fit: boolean;
  /** The zoom Fit gives at the current stage size. */
  fitZoom: number;
  /** The stage's size on screen, once the UI has measured it. */
  stage: CanvasSize | null;
  /** Where the canvas's top-left corner is on screen. */
  origin: Point;
}

export interface Capabilities {
  readOnly: boolean;
  /** Why changes are refused, for the UI to show; null exactly when `readOnly` is false. */
  readOnlyReason: string | null;
  /** Placements may be hidden: on a scene, where a hidden widget keeps running out of sight. */
  canHide: boolean;
  /** The composition has a timeline to scrub: an alert. */
  hasTimeline: boolean;
  /** The anchors a behavior's timing may use here (the profile's): what a timing picker offers. */
  anchors: readonly AnchorKind[];
  /** Other editors may be here. */
  presence: boolean;
}

export interface Playhead {
  playheadMs: number;
  playing: boolean;
}

export interface TimelineState extends Playhead {
  /**
   * An alert's tracks: when each widget and behavior runs, with every
   * widget lasting its `settings.duration` and nothing observed. Null for a
   * scene, which has no timeline, and before the document loads.
   */
  tracks: ResolvedTimeline | null;
}

export interface EditorState {
  /** The committed document, or null before it loads. */
  doc: CompositionDocument | null;
  view: ViewState;
  selection: SelectionState;
  transient: TransientState | null;
  guides: readonly Guide[];
  viewport: ViewportState;
  history: { canUndo: boolean; canRedo: boolean };
  capabilities: Capabilities;
  timeline: TimelineState;
  peers: readonly Peer[];
  /** The catalog widgets that may be added here. */
  palette: readonly CatalogWidget[];
}

export type CommandResult = ApplyResult;
export type AddResult = { ok: true; id: string } | { ok: false; detail: string };

export interface GestureStart {
  kind: GestureKind;
  /** The node pressed; defaults to the primary selection. */
  node?: NodeId;
  /** Which handle, for a resize. */
  handle?: ResizeHandle;
  /** Where the pointer went down, on screen. */
  point: Point;
  /** Touch snaps from farther away. */
  pointer?: "mouse" | "pen" | "touch";
}

export interface GestureModifiers {
  /** Move: none. Resize: flips the aspect lock. Rotate: snaps to 15 degrees. */
  shift?: boolean;
  /** Turns snapping off. */
  alt?: boolean;
}

/**
 * Layout keys a canvas patch sets, each replaced whole; a key left out or
 * set to undefined is left as it is. The registry checks the result: the
 * size stays a positive number.
 */
export interface CanvasPatch {
  width?: number;
  height?: number;
  backgroundColor?: string;
  [key: string]: unknown;
}

/** Placement fields a patch may set. `settings` and `extra` merge key by key; the rest replace. */
export type PlacementPatch = Partial<Omit<PlacementDocument, "widget" | "z">>;

export type BehaviorPatch = Partial<Pick<BehaviorDocument, "kind" | "timing" | "params">>;

export interface CompositionEditor {
  getState(): EditorState;
  subscribe(listener: () => void): () => void;
  /** Run a command. Throws for an id that is not a command. */
  dispatch(command: CommandId, args?: Record<string, unknown>): CommandResult;
  /**
   * Run the command a key is bound to, and say whether the key was used:
   * false when it is bound to nothing or its command did nothing (an arrow
   * with nothing selected, undo with nothing to undo, any edit while
   * read-only), so the UI lets the browser have it.
   */
  handleKey(input: KeyInput): boolean;
  /**
   * Offer `catalog` as the installed widgets from now on: the palette and
   * new placements' defaults follow it. The document, selection and history
   * stay; placements of widgets no longer offered stay where they are.
   */
  setCatalog(catalog: readonly CatalogWidget[]): void;
  readonly canvas: {
    /** Set layout keys (size, background, any other) as one change, which undoes as one. */
    patch(patch: CanvasPatch): CommandResult;
  };
  readonly gesture: {
    /** False when nothing can be moved: no such node, locked, read-only, or a canvas with no size. */
    begin(start: GestureStart): boolean;
    update(point: Point, modifiers?: GestureModifiers): void;
    /** Commit what the gesture did as one change. */
    end(): CommandResult;
    cancel(): void;
  };
  readonly nodes: {
    add(widgetId: string, at?: Point): AddResult;
    patch(id: NodeId, patch: PlacementPatch): CommandResult;
    /** Resize keeping the centre; a node that keeps its aspect takes its height from the width when none is given. */
    resize(id: NodeId, size: { width: number; height?: number }): CommandResult;
    /** Move so the centre is at `center`, kept on the canvas. */
    moveCenter(id: NodeId, center: Point): CommandResult;
    /** Move to `index` in the stack, bottom first. Only this node's key changes. */
    reorder(id: NodeId, to: { index: number }): CommandResult;
    remove(ids: readonly NodeId[]): CommandResult;
  };
  readonly behaviors: {
    /**
     * Timing and params the call leaves out take the type's defaults. A
     * kind, timing or params that do not make a valid behavior of the type
     * are refused, with the registry's reason.
     */
    add(
      target: NodeId | typeof CANVAS_TARGET,
      type: string,
      kind: string,
      timing?: Partial<Timing>,
      params?: Record<string, unknown>
    ): AddResult;
    patch(id: BehaviorId, patch: BehaviorPatch): CommandResult;
    remove(id: BehaviorId): CommandResult;
    /** Move to `index` among its target's behaviors, first first. Only this behavior's key changes. */
    reorder(id: BehaviorId, to: { index: number }): CommandResult;
  };
  readonly history: {
    undo(): CommandResult;
    redo(): CommandResult;
  };
  readonly viewport: {
    /** The stage's measured size: Fit follows it. */
    setStage(size: CanvasSize): void;
    setOrigin(origin: Point): void;
    setZoom(zoom: number): void;
    screenToCanvas(point: Point): Point;
    canvasToScreen(point: Point): Point;
  };
  readonly timeline: {
    seek(ms: number): void;
    play(): void;
    pause(): void;
    /** Move a playing playhead on by `ms`: the UI calls this from its animation frame. */
    advance(ms: number): void;
  };
  readonly preview: {
    frame(): PreviewFrame | null;
    /** The `woofx3.scene-preview.layout` message the overlay preview takes. */
    layoutMessage(options?: { placements?: boolean }): PreviewLayoutMessage | null;
  };
  /** Stop listening to the source. */
  destroy(): void;
}

const NO_CANVAS_SIZE = "the canvas has no size: set its width and height";

/** How far a duplicate or paste lands from what it copies. */
const PASTE_OFFSET = 20;

interface ActiveGesture {
  kind: GestureKind;
  ids: NodeId[];
  handle: ResizeHandle | null;
  startPoint: Point;
  starts: Record<NodeId, Box>;
  targets: SnapTargets;
  snapDistance: number;
  canvas: CanvasSize;
}

interface Clipboard {
  placements: Array<{ id: NodeId; placement: PlacementDocument }>;
  behaviors: BehaviorDocument[];
  pastes: number;
}

export function createCompositionEditor(options: CompositionEditorOptions): CompositionEditor {
  const { source, profile } = options;
  const registry = options.registry ?? TOLERANT_REGISTRY;
  const keymap = options.keymap ?? DEFAULT_KEYMAP;
  const now = options.now ?? (() => Date.now());
  const newNodeId = options.newNodeId ?? randomNodeId;
  const newBehaviorId = options.newBehaviorId ?? randomBehaviorId;
  let catalog: readonly CatalogWidget[] = options.catalog;
  let palette = placeableOn(catalog, profile);
  const history = new EditHistory();
  const listeners = new Set<() => void>();

  let lastDoc: CompositionDocument | null = source.getDocument();
  let applying = false;
  let selection: NodeId[] = [];
  let gesture: ActiveGesture | null = null;
  let transientBoxes: Record<NodeId, Box> | null = null;
  let guides: Guide[] = [];
  let clipboard: Clipboard | null = null;
  let viewport: ViewportState = {
    zoom: DEFAULT_ZOOM,
    fit: true,
    fitZoom: DEFAULT_ZOOM,
    stage: null,
    origin: { x: 0, y: 0 },
  };
  let playhead: Playhead = { playheadMs: 0, playing: false };
  let tracksCache: { doc: CompositionDocument; tracks: ResolvedTimeline } | null = null;
  let state: EditorState = buildState(null);

  const unsubscribe = source.subscribe(() => {
    if (applying) {
      return;
    }
    sourceChanged();
  });

  // -------------------------------------------------------------------------
  // State

  function emit(): void {
    const next = buildState(state);
    if (next === state) {
      return;
    }
    state = next;
    for (const listener of [...listeners]) {
      listener();
    }
  }

  /** The next snapshot, reusing every part of `previous` that has not changed. */
  function buildState(previous: EditorState | null): EditorState {
    const doc = lastDoc;
    const measured = doc === null ? null : canvasSizeOf(doc);
    const canvas = sameSize(previous?.view.canvas ?? null, measured) ? (previous?.view.canvas ?? null) : measured;
    const selectionState = sameList(previous?.selection.ids, selection)
      ? (previous as EditorState).selection
      : { ids: [...selection], primary: selection[selection.length - 1] ?? null };
    const nodes = buildNodes(doc, previous?.view.nodes ?? [], selectionState.ids);
    const view =
      previous !== null && previous.view.canvas === canvas && previous.view.nodes === nodes
        ? previous.view
        : { canvas, nodes };
    const transient = buildTransient(previous?.transient ?? null);
    const guideList = sameGuides(previous?.guides ?? [], guides) && previous !== null ? previous.guides : [...guides];
    const fitted = updateFit(canvas);
    const historyState =
      previous !== null && previous.history.canUndo === history.canUndo && previous.history.canRedo === history.canRedo
        ? previous.history
        : { canUndo: history.canUndo, canRedo: history.canRedo };
    const capabilities = buildCapabilities(previous?.capabilities ?? null);
    const peers = source.presence?.peers() ?? [];
    const peerList = previous !== null && samePeers(previous.peers, peers) ? previous.peers : peers;
    const tracks = tracksOf(doc);
    const timelineState =
      previous !== null &&
      previous.timeline.playheadMs === playhead.playheadMs &&
      previous.timeline.playing === playhead.playing &&
      previous.timeline.tracks === tracks
        ? previous.timeline
        : { ...playhead, tracks };
    const candidate: EditorState = {
      doc,
      view,
      selection: selectionState,
      transient,
      guides: guideList,
      viewport: previous !== null && sameViewport(previous.viewport, fitted) ? previous.viewport : fitted,
      history: historyState,
      capabilities,
      timeline: timelineState,
      peers: peerList,
      palette,
    };
    if (
      previous !== null &&
      (Object.keys(candidate) as Array<keyof EditorState>).every((key) => candidate[key] === previous[key])
    ) {
      return previous;
    }
    return candidate;
  }

  /**
   * The alert's estimated tracks, resolved again only when the committed
   * document changes: a gesture moves boxes, which no timing depends on.
   */
  function tracksOf(doc: CompositionDocument | null): ResolvedTimeline | null {
    if (doc === null || !profile.bounded) {
      return null;
    }
    if (tracksCache === null || tracksCache.doc !== doc) {
      tracksCache = {
        doc,
        tracks: resolveTimeline(
          doc,
          profile,
          { startedAtMs: 0 },
          { estimate: { durationsMs: mediaLengthEstimates(doc) } }
        ),
      };
    }
    return tracksCache.tracks;
  }

  function buildNodes(
    doc: CompositionDocument | null,
    previous: readonly NodeView[],
    selected: readonly NodeId[]
  ): readonly NodeView[] {
    if (doc === null) {
      return previous.length === 0 ? previous : [];
    }
    const byId = new Map(previous.map((node) => [node.id, node]));
    const order = stackOrder(doc);
    let changed = order.length !== previous.length;
    const nodes = order.map((id, index) => {
      const placement = doc.widgets[id] as PlacementDocument;
      const override = transientBoxes?.[id];
      const box = override ?? boxOf(placement);
      const isSelected = selected.includes(id);
      const old = byId.get(id);
      if (
        old !== undefined &&
        (old.placement === placement || sameValue(old.placement, placement)) &&
        sameBox(old.box, box) &&
        old.selected === isSelected &&
        old.transient === (override !== undefined)
      ) {
        if (previous[index] !== old) {
          changed = true;
        }
        return old;
      }
      changed = true;
      return {
        id,
        placement,
        box,
        kind: widgetKind(placement.widget),
        selected: isSelected,
        transient: override !== undefined,
        keepsAspect: registry.widgetTraits(placement.widget).keepsAspect,
      };
    });
    return changed ? nodes : previous;
  }

  function buildTransient(previous: TransientState | null): TransientState | null {
    if (gesture === null || transientBoxes === null) {
      return null;
    }
    if (previous !== null && previous.gesture === gesture.kind && sameBoxes(previous.boxes, transientBoxes)) {
      return previous;
    }
    return { gesture: gesture.kind, boxes: { ...transientBoxes } };
  }

  function buildCapabilities(previous: Capabilities | null): Capabilities {
    const reason = blocked();
    const next: Capabilities = {
      readOnly: reason !== null,
      readOnlyReason: reason,
      canHide: profile.id === "scene",
      hasTimeline: profile.bounded,
      anchors: profile.anchors,
      presence: source.presence !== undefined,
    };
    if (
      previous !== null &&
      (Object.keys(next) as Array<keyof Capabilities>).every((key) => next[key] === previous[key])
    ) {
      return previous;
    }
    return next;
  }

  function updateFit(canvas: CanvasSize | null): ViewportState {
    if (canvas === null || viewport.stage === null) {
      return viewport;
    }
    const fitted = fitZoom(viewport.stage, canvas, FIT_PADDING);
    if (fitted !== viewport.fitZoom || (viewport.fit && viewport.zoom !== fitted)) {
      viewport = { ...viewport, fitZoom: fitted, zoom: viewport.fit ? fitted : viewport.zoom };
    }
    return viewport;
  }

  /**
   * The source changed without this editor applying anything: another
   * editor's change, a refused change rolled back, or the first load. What
   * changed is moved into history, so undo still reverts only this user's
   * changes, and selection and any gesture let go of nodes that are gone.
   */
  function sourceChanged(): void {
    const next = source.getDocument();
    if (lastDoc !== null && next !== null && next !== lastDoc) {
      history.transformPast(diffCompositions(lastDoc, next));
    } else if (next === null) {
      history.clear();
    }
    lastDoc = next;
    const present = (id: NodeId) => next !== null && Object.hasOwn(next.widgets, id);
    selection = selection.filter(present);
    if (gesture !== null && !gesture.ids.every(present)) {
      clearGesture();
    }
    emit();
  }

  // -------------------------------------------------------------------------
  // Committing

  function refuse(detail: string): CommandResult {
    return { ok: false, detail };
  }

  /** Why no change can be made now, or null when one can. */
  function blocked(): string | null {
    if (lastDoc === null) {
      return "the document has not loaded";
    }
    if (source.readOnly) {
      return source.readOnlyReason ?? "the document is read-only";
    }
    return null;
  }

  /**
   * The canvas size, or a refusal for a document stored without one that
   * can be drawn. Edits cannot leave a canvas like that (the registry
   * refuses them), so this is a loaded document's problem, which the user
   * fixes by setting the size; until then nothing that works out a position
   * on the canvas can run.
   */
  function canvasOrRefusal(doc: CompositionDocument): CanvasSize | { ok: false; detail: string } {
    return canvasSizeOf(doc) ?? { ok: false, detail: NO_CANVAS_SIZE };
  }

  /**
   * Apply one change through the source and hand the ops it made to
   * `recorded`. The registry sees the whole result first; a document it
   * refuses is never applied.
   */
  function change(
    update: (doc: CompositionDocument) => CompositionDocument,
    recorded: (ops: Ops) => void
  ): CommandResult {
    const block = blocked();
    if (block !== null) {
      return refuse(block);
    }
    const outcome: { refusal: string | null } = { refusal: null };
    const before = lastDoc as CompositionDocument;
    let result: ApplyResult;
    applying = true;
    try {
      result = source.apply((doc) => {
        const next = update(structuredClone(doc));
        const invalid = isCompositionShape(next) ? registry.invalidEdit(doc, next) : "not a composition";
        if (invalid !== null) {
          outcome.refusal = invalid;
          return doc;
        }
        return next;
      });
    } finally {
      applying = false;
    }
    const after = source.getDocument();
    if (outcome.refusal !== null) {
      result = refuse(outcome.refusal);
    }
    if (result.ok && after !== null) {
      recorded(diffCompositions(before, after));
    } else if (after !== null && after !== before) {
      // The source changed for some other reason while it refused (it never
      // should): treat it as a change from elsewhere.
      history.transformPast(diffCompositions(before, after));
    }
    lastDoc = after;
    emit();
    return result;
  }

  /** A user change: one undo entry, joined with the previous one when `coalesceKey` matches within the window. */
  function commit(
    update: (doc: CompositionDocument) => CompositionDocument,
    coalesceKey: string | null = null
  ): CommandResult {
    return change(update, (ops) => history.record(ops, coalesceKey, now()));
  }

  function undo(): CommandResult {
    const ops = history.peekUndo();
    if (ops === null) {
      return refuse("nothing to undo");
    }
    const stale = applyable(ops);
    if (stale !== null) {
      history.dropUndo();
      emit();
      return refuse(stale);
    }
    return change(
      (doc) => applyCompositionOps(doc, ops),
      (applied) => history.undone(applied)
    );
  }

  function redo(): CommandResult {
    const ops = history.peekRedo();
    if (ops === null) {
      return refuse("nothing to redo");
    }
    const stale = applyable(ops);
    if (stale !== null) {
      history.dropRedo();
      emit();
      return refuse(stale);
    }
    return change(
      (doc) => applyCompositionOps(doc, ops),
      (applied) => history.redone(applied)
    );
  }

  /** Why `ops` no longer apply to the document, or null when they do. */
  function applyable(ops: Ops): string | null {
    if (lastDoc === null) {
      return "the document has not loaded";
    }
    try {
      applyCompositionOps(lastDoc, ops);
      return null;
    } catch {
      return "that change no longer applies";
    }
  }

  // -------------------------------------------------------------------------
  // Selection

  function setSelection(ids: NodeId[]): void {
    const doc = lastDoc;
    const next =
      doc === null ? [] : ids.filter((id, index) => Object.hasOwn(doc.widgets, id) && ids.indexOf(id) === index);
    if (sameList(selection, next)) {
      return;
    }
    selection = next;
    source.presence?.setSelection(selection[selection.length - 1] ?? null);
    emit();
  }

  function select(id: NodeId, additive: boolean): void {
    if (!additive) {
      setSelection([id]);
      return;
    }
    setSelection(selection.includes(id) ? selection.filter((other) => other !== id) : [...selection, id]);
  }

  function selectedIds(): NodeId[] {
    return [...selection];
  }

  // -------------------------------------------------------------------------
  // Placements

  function addNode(widgetId: string, at?: Point): AddResult {
    const block = blocked();
    if (block !== null) {
      return { ok: false, detail: block };
    }
    const row = palette.find((entry) => entry.widgetId === widgetId);
    if (row === undefined) {
      return {
        ok: false,
        detail: `${widgetId} cannot be placed on ${profile.id === "alert" ? "an alert" : "a scene"}`,
      };
    }
    if (canvasSizeOf(lastDoc as CompositionDocument) === null) {
      return { ok: false, detail: NO_CANVAS_SIZE };
    }
    const id = freshNodeId(lastDoc as CompositionDocument);
    const result = commit((doc) => {
      const placement = newPlacement({ row, catalog, doc, profile, at });
      return { ...doc, widgets: { ...doc.widgets, [id]: placement } };
    });
    if (!result.ok) {
      return result;
    }
    setSelection([id]);
    return { ok: true, id };
  }

  function freshNodeId(doc: CompositionDocument): NodeId {
    const id = newNodeId(new Set(Object.keys(doc.widgets)));
    assert(NODE_ID_PATTERN.test(id), `placement id "${id}" is not a URL-safe token`);
    assert(!Object.hasOwn(doc.widgets, id), `placement id "${id}" is taken`);
    return id;
  }

  /** Change the placements `ids` with `edit`; ids no longer in the document are skipped. */
  function editPlacements(
    ids: readonly NodeId[],
    edit: (placement: PlacementDocument, id: NodeId, doc: CompositionDocument) => PlacementDocument,
    coalesceKey: string | null = null
  ): CommandResult {
    if (ids.length === 0) {
      return refuse("nothing is selected");
    }
    return commit((doc) => {
      const widgets = { ...doc.widgets };
      for (const id of ids) {
        const placement = widgets[id];
        if (placement !== undefined) {
          widgets[id] = edit(placement, id, doc);
        }
      }
      return { ...doc, widgets };
    }, coalesceKey);
  }

  function patchNode(id: NodeId, patch: PlacementPatch): CommandResult {
    if (lastDoc === null || !Object.hasOwn(lastDoc.widgets, id)) {
      return refuse(`there is no placement ${id}`);
    }
    for (const [field, value] of Object.entries(patch)) {
      if (["x", "y", "width", "height", "rotation", "opacity"].includes(field)) {
        assert(typeof value === "number" && Number.isFinite(value), `${field} is a finite number`);
      }
    }
    const fields = Object.keys(patch).sort();
    const settingKeys = Object.keys(patch.settings ?? {}).sort();
    const coalesceKey = `patch:${id}:${fields.join(",")}:${settingKeys.join(",")}`;
    return editPlacements(
      [id],
      (placement) => {
        const next: PlacementDocument = {
          ...placement,
          ...patch,
          settings: { ...placement.settings, ...(patch.settings ?? {}) },
          extra: { ...placement.extra, ...(patch.extra ?? {}) },
        };
        return withTypeRules(placement, next, patch);
      },
      coalesceKey
    );
  }

  /**
   * Rules a widget's traits impose on an edit: a box whose height follows
   * its text grows with the text and font size, about its centre.
   */
  function withTypeRules(before: PlacementDocument, next: PlacementDocument, patch: PlacementPatch): PlacementDocument {
    if (!registry.widgetTraits(next.widget).heightFollowsText || patch.height !== undefined) {
      return next;
    }
    const text = typeof next.settings.text === "string" ? next.settings.text : "";
    const fontSize = typeof next.settings.fontSize === "number" ? next.settings.fontSize : 48;
    const textChanged =
      before.settings.text !== next.settings.text || before.settings.fontSize !== next.settings.fontSize;
    if (!textChanged) {
      return next;
    }
    const center = centerOf(next);
    return withCenter({ ...next, height: textBoxHeight(fontSize, text) }, center);
  }

  function resizeNode(id: NodeId, size: { width: number; height?: number }): CommandResult {
    assert(Number.isFinite(size.width) && size.width > 0, "a width is a positive number");
    return editPlacements(
      [id],
      (placement) => {
        const height =
          size.height ??
          (registry.widgetTraits(placement.widget).keepsAspect && placement.width > 0
            ? Math.round((size.width * placement.height) / placement.width)
            : placement.height);
        const center = centerOf(placement);
        return withCenter({ ...placement, width: Math.round(size.width), height }, center);
      },
      `resize:${id}`
    );
  }

  function moveNodeCenter(id: NodeId, center: Point): CommandResult {
    const doc = lastDoc;
    if (doc === null) {
      return refuse("the document has not loaded");
    }
    const canvas = canvasOrRefusal(doc);
    if ("ok" in canvas) {
      return canvas;
    }
    return editPlacements([id], (placement) => withCenter(placement, clampCenter(center, canvas)), `move:${id}`);
  }

  function removeNodes(ids: readonly NodeId[]): CommandResult {
    if (ids.length === 0) {
      return refuse("nothing is selected");
    }
    const removing = new Set(ids);
    const result = commit((doc) => {
      let next = doc;
      for (const id of removing) {
        next = withoutWidget(next, id);
      }
      return next;
    });
    if (result.ok) {
      setSelection(selection.filter((id) => !removing.has(id)));
    }
    return result;
  }

  function nudge(dx: number, dy: number): CommandResult {
    assert(Number.isFinite(dx) && Number.isFinite(dy), "a nudge is a finite distance");
    const doc = lastDoc;
    if (doc === null) {
      return refuse("the document has not loaded");
    }
    const ids = selectedIds().filter((id) => doc.widgets[id]?.locked === false);
    if (ids.length === 0) {
      return refuse(selection.length === 0 ? "nothing is selected" : "the selection is locked");
    }
    const canvas = canvasOrRefusal(doc);
    if ("ok" in canvas) {
      return canvas;
    }
    return editPlacements(
      ids,
      (placement) => {
        const center = centerOf(placement);
        return withCenter(placement, clampCenter({ x: center.x + dx, y: center.y + dy }, canvas));
      },
      `nudge:${ids.join(",")}`
    );
  }

  function toggleField(field: "visible" | "locked"): CommandResult {
    const doc = lastDoc;
    if (doc === null) {
      return refuse("the document has not loaded");
    }
    if (field === "visible" && profile.id !== "scene") {
      return refuse("only a scene's widgets can be hidden");
    }
    const ids = selectedIds();
    // Mixed selections go the way a click on the first would: hide if any is visible, lock if any is unlocked.
    const value =
      field === "visible"
        ? !ids.some((id) => doc.widgets[id]?.visible === true)
        : ids.some((id) => doc.widgets[id]?.locked === false);
    return editPlacements(ids, (placement) => ({ ...placement, [field]: value }));
  }

  // -------------------------------------------------------------------------
  // Stacking

  /**
   * Move `id` to `index` in the stack (bottom first, counted with `id`
   * itself in the stack). Only its key changes, unless its neighbours leave
   * no room between them; then the whole stack is renumbered once.
   */
  function reorderNode(id: NodeId, index: number): CommandResult {
    const doc = lastDoc;
    if (doc === null || !Object.hasOwn(doc.widgets, id)) {
      return refuse(`there is no placement ${id}`);
    }
    const order = stackOrder(doc);
    const target = Math.max(0, Math.min(index, order.length - 1));
    if (order.indexOf(id) === target) {
      return { ok: true };
    }
    return commit((current) => restack(current, id, target));
  }

  function restack(doc: CompositionDocument, id: NodeId, index: number): CompositionDocument {
    const others = stackOrder(doc).filter((other) => other !== id);
    const position = Math.max(0, Math.min(index, others.length));
    const keys = others.map((other) => (doc.widgets[other] as PlacementDocument).z);
    const key = keyAt(keys, position);
    const widgets = { ...doc.widgets };
    if (key !== null) {
      widgets[id] = { ...(widgets[id] as PlacementDocument), z: key };
      return { ...doc, widgets };
    }
    const order = [...others.slice(0, position), id, ...others.slice(position)];
    const fresh = keysBetween(null, null, order.length);
    order.forEach((other, i) => {
      widgets[other] = { ...(widgets[other] as PlacementDocument), z: fresh[i] as string };
    });
    return { ...doc, widgets };
  }

  function layerCommand(
    command: "layer.bringForward" | "layer.sendBackward" | "layer.toFront" | "layer.toBack"
  ): CommandResult {
    const doc = lastDoc;
    if (doc === null) {
      return refuse("the document has not loaded");
    }
    const ids = selectedIds();
    if (ids.length === 0) {
      return refuse("nothing is selected");
    }
    const order = stackOrder(doc);
    // Move the selection as a group, keeping its own order: the top one first when going up.
    const moving = order.filter((id) => ids.includes(id));
    const upward = command === "layer.bringForward" || command === "layer.toFront";
    const sequence = upward ? [...moving].reverse() : moving;
    return commit((current) => {
      let next = current;
      sequence.forEach((id, i) => {
        const stack = stackOrder(next);
        const from = stack.indexOf(id);
        let to: number;
        switch (command) {
          case "layer.toFront":
            to = stack.length - 1 - i;
            break;
          case "layer.toBack":
            to = i;
            break;
          case "layer.bringForward":
            to = Math.min(from + 1, stack.length - 1 - i);
            break;
          case "layer.sendBackward":
            to = Math.max(from - 1, i);
            break;
        }
        if (to !== from) {
          next = restack(next, id, to);
        }
      });
      return next;
    });
  }

  // -------------------------------------------------------------------------
  // Duplicate, copy, paste

  function copySelection(): Clipboard | null {
    const doc = lastDoc;
    if (doc === null || selection.length === 0) {
      return null;
    }
    const order = stackOrder(doc).filter((id) => selection.includes(id));
    const ids = new Set(order);
    return {
      placements: order.map((id) => ({ id, placement: structuredClone(doc.widgets[id] as PlacementDocument) })),
      behaviors: Object.values(doc.behaviors)
        .filter((behavior) => ids.has(behavior.target))
        .map((behavior) => structuredClone(behavior)),
      pastes: 0,
    };
  }

  /**
   * Put copies of `copied` on top of the stack, `offset` from the
   * originals, with fresh ids, their behaviors retargeted to them, and
   * alert areas renamed so no two share a name.
   */
  function pasteCopies(copied: Clipboard, offset: number): CommandResult {
    const doc = lastDoc;
    if (doc === null) {
      return refuse("the document has not loaded");
    }
    const placeable = new Set(palette.map((row) => row.widgetId));
    const pasting = copied.placements.filter(({ placement }) => placeable.has(placement.widget));
    if (pasting.length === 0) {
      return refuse("nothing to paste here");
    }
    const canvas = canvasOrRefusal(doc);
    if ("ok" in canvas) {
      return canvas;
    }
    const takenNodes = new Set(Object.keys(doc.widgets));
    const idMap = new Map<NodeId, NodeId>();
    for (const { id } of pasting) {
      const fresh = newNodeId(takenNodes);
      assert(NODE_ID_PATTERN.test(fresh) && !takenNodes.has(fresh), `placement id "${fresh}" is not fresh`);
      takenNodes.add(fresh);
      idMap.set(id, fresh);
    }
    const alertHosts = new Set(catalog.filter((row) => row.hostsSurface === ALERT_SURFACE).map((row) => row.widgetId));
    const result = commit((current) => {
      const order = stackOrder(current);
      const top =
        order.length === 0 ? null : (current.widgets[order[order.length - 1] as string] as PlacementDocument).z;
      const keys = keysBetween(top, null, pasting.length);
      const widgets = { ...current.widgets };
      const hostNames = Object.values(current.widgets)
        .filter((placement) => alertHosts.has(placement.widget))
        .map((placement) => alertWidgetName(placement.settings));
      pasting.forEach(({ id, placement }, i) => {
        const center = centerOf(placement);
        const copy: PlacementDocument = {
          ...structuredClone(placement),
          z: keys[i] as string,
          locked: false,
        };
        if (alertHosts.has(placement.widget)) {
          const name = nextAlertWidgetName(hostNames);
          hostNames.push(name);
          copy.settings = { ...copy.settings, name };
        }
        widgets[idMap.get(id) as NodeId] = withCenter(
          copy,
          clampCenter({ x: center.x + offset, y: center.y + offset }, canvas)
        );
      });
      const behaviors = { ...current.behaviors };
      const takenBehaviors = new Set(Object.keys(behaviors));
      for (const behavior of copied.behaviors) {
        const target = idMap.get(behavior.target);
        if (target === undefined) {
          continue;
        }
        const behaviorId = newBehaviorId(takenBehaviors);
        assert(!takenBehaviors.has(behaviorId), `behavior id "${behaviorId}" is taken`);
        takenBehaviors.add(behaviorId);
        const timing = { ...behavior.timing };
        if (timing.node !== undefined && idMap.has(timing.node)) {
          timing.node = idMap.get(timing.node) as NodeId;
        }
        behaviors[behaviorId] = { ...structuredClone(behavior), target, timing };
      }
      return { ...current, widgets, behaviors };
    });
    if (result.ok) {
      setSelection([...idMap.values()]);
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Behaviors

  function behaviorKeys(doc: CompositionDocument, target: string, except: BehaviorId | null): string[] {
    const siblings: Record<BehaviorId, BehaviorDocument> = {};
    for (const [id, behavior] of Object.entries(doc.behaviors)) {
      if (behavior.target === target && id !== except) {
        siblings[id] = behavior;
      }
    }
    return orderByKey(siblings, (behavior) => behavior.order);
  }

  function addBehavior(
    target: NodeId | typeof CANVAS_TARGET,
    type: string,
    kind: string,
    timing: Partial<Timing> = {},
    params: Record<string, unknown> = {}
  ): AddResult {
    const doc = lastDoc;
    if (doc === null) {
      return { ok: false, detail: "the document has not loaded" };
    }
    if (registry.type("behaviors", type) === undefined) {
      return { ok: false, detail: `there is no behavior type ${type}` };
    }
    if (target !== CANVAS_TARGET && !Object.hasOwn(doc.widgets, target)) {
      return { ok: false, detail: `there is no placement ${target}` };
    }
    const built = registry.tryCreate("behaviors", type, {
      kind,
      target,
      order: nextBehaviorOrder(doc, target),
      timing: structuredClone(timing),
      params: structuredClone(params),
    });
    if (!built.ok) {
      return built;
    }
    const behavior = built.entry as unknown as BehaviorDocument;
    // Checked on the built behavior: the type's default timing may use an anchor this profile does not have.
    if (!profile.anchors.includes(behavior.timing.anchor)) {
      return { ok: false, detail: `a ${profile.id} cannot time from ${behavior.timing.anchor}` };
    }
    const id = newBehaviorId(new Set(Object.keys(doc.behaviors)));
    assert(!Object.hasOwn(doc.behaviors, id), `behavior id "${id}" is taken`);
    const result = commit((current) => ({
      ...current,
      behaviors: { ...current.behaviors, [id]: { ...behavior, order: nextBehaviorOrder(current, target) } },
    }));
    return result.ok ? { ok: true, id } : result;
  }

  /** The order key that puts a new behavior after every one `target` has in `doc`. */
  function nextBehaviorOrder(doc: CompositionDocument, target: string): string {
    const siblings = behaviorKeys(doc, target, null);
    const last =
      siblings.length === 0 ? null : (doc.behaviors[siblings[siblings.length - 1] as string] as BehaviorDocument).order;
    return keyAfter(last);
  }

  function patchBehavior(id: BehaviorId, patch: BehaviorPatch): CommandResult {
    const doc = lastDoc;
    if (doc === null || !Object.hasOwn(doc.behaviors, id)) {
      return refuse(`there is no behavior ${id}`);
    }
    if (patch.timing !== undefined && !profile.anchors.includes(patch.timing.anchor)) {
      return refuse(`a ${profile.id} cannot time from ${patch.timing.anchor}`);
    }
    return commit(
      (current) => {
        const behavior = current.behaviors[id];
        if (behavior === undefined) {
          return current;
        }
        return { ...current, behaviors: { ...current.behaviors, [id]: { ...behavior, ...structuredClone(patch) } } };
      },
      `behavior:${id}:${Object.keys(patch).sort().join(",")}`
    );
  }

  function removeBehavior(id: BehaviorId): CommandResult {
    if (lastDoc === null || !Object.hasOwn(lastDoc.behaviors, id)) {
      return refuse(`there is no behavior ${id}`);
    }
    return commit((current) => {
      const behaviors = { ...current.behaviors };
      delete behaviors[id];
      return { ...current, behaviors };
    });
  }

  function reorderBehavior(id: BehaviorId, index: number): CommandResult {
    const doc = lastDoc;
    const behavior = doc?.behaviors[id];
    if (doc === null || behavior === undefined) {
      return refuse(`there is no behavior ${id}`);
    }
    return commit((current) => {
      const moving = current.behaviors[id];
      if (moving === undefined) {
        return current;
      }
      const others = behaviorKeys(current, moving.target, id);
      const position = Math.max(0, Math.min(index, others.length));
      const keys = others.map((other) => (current.behaviors[other] as BehaviorDocument).order);
      const key = keyAt(keys, position);
      const behaviors = { ...current.behaviors };
      if (key !== null) {
        behaviors[id] = { ...moving, order: key };
        return { ...current, behaviors };
      }
      const order = [...others.slice(0, position), id, ...others.slice(position)];
      const fresh = keysBetween(null, null, order.length);
      order.forEach((other, i) => {
        behaviors[other] = { ...(behaviors[other] as BehaviorDocument), order: fresh[i] as string };
      });
      return { ...current, behaviors };
    });
  }

  // -------------------------------------------------------------------------
  // Canvas

  function patchCanvas(patch: CanvasPatch): CommandResult {
    const keys = Object.keys(patch)
      .filter((key) => patch[key] !== undefined)
      .sort();
    return commit(
      (doc) => {
        const layout = { ...doc.layout };
        for (const key of keys) {
          layout[key] = structuredClone(patch[key]);
        }
        return { ...doc, layout };
      },
      `canvas:${keys.join(",")}`
    );
  }

  function setCatalog(next: readonly CatalogWidget[]): void {
    catalog = next;
    const nextPalette = placeableOn(next, profile);
    if (!sameValue(palette, nextPalette)) {
      palette = nextPalette;
    }
    emit();
  }

  // -------------------------------------------------------------------------
  // Gestures

  function beginGesture(start: GestureStart): boolean {
    const doc = lastDoc;
    if (doc === null || source.readOnly || gesture !== null) {
      return false;
    }
    const id = start.node ?? selection[selection.length - 1];
    if (id === undefined || !Object.hasOwn(doc.widgets, id)) {
      return false;
    }
    if (!selection.includes(id)) {
      setSelection([id]);
    }
    const placement = doc.widgets[id] as PlacementDocument;
    const canvas = canvasSizeOf(doc);
    if (placement.locked || canvas === null) {
      return false;
    }
    let ids: NodeId[];
    if (start.kind === "move") {
      ids = selection.filter((other) => doc.widgets[other]?.locked === false);
    } else {
      assert(start.kind === "rotate" || start.handle !== undefined, "a resize names its handle");
      ids = [id];
    }
    const starts: Record<NodeId, Box> = {};
    for (const other of ids) {
      starts[other] = boxOf(doc.widgets[other] as PlacementDocument);
    }
    const others = stackOrder(doc)
      .filter((other) => !ids.includes(other) && doc.widgets[other]?.visible === true)
      .map((other) => ({ id: other, box: boxOf(doc.widgets[other] as PlacementDocument) }));
    gesture = {
      kind: start.kind,
      ids,
      handle: start.handle ?? null,
      startPoint: screenToCanvas(start.point),
      starts,
      targets: snapTargets(canvas, others),
      snapDistance: start.pointer === "touch" ? SNAP_DISTANCE_TOUCH : SNAP_DISTANCE,
      canvas,
    };
    transientBoxes = { ...starts };
    guides = [];
    emit();
    return true;
  }

  function updateGesture(point: Point, modifiers: GestureModifiers = {}): void {
    const active = gesture;
    if (active === null) {
      return;
    }
    const at = screenToCanvas(point);
    const delta = { x: at.x - active.startPoint.x, y: at.y - active.startPoint.y };
    const snapping = modifiers.alt !== true;
    switch (active.kind) {
      case "move": {
        const bounds = unionOf(Object.values(active.starts));
        const center = clampCenter({ x: centerOf(bounds).x + delta.x, y: centerOf(bounds).y + delta.y }, active.canvas);
        const moved = withCenterExact(bounds, center);
        const snapped = snapping
          ? snapBox(moved, active.targets, active.snapDistance)
          : { x: moved.x, y: moved.y, guides: [] as Guide[] };
        const shift = { x: Math.round(snapped.x - bounds.x), y: Math.round(snapped.y - bounds.y) };
        const boxes: Record<NodeId, Box> = {};
        for (const id of active.ids) {
          const start = active.starts[id] as Box;
          boxes[id] = { ...start, x: start.x + shift.x, y: start.y + shift.y };
        }
        transientBoxes = boxes;
        guides = snapped.guides;
        break;
      }
      case "resize": {
        const id = active.ids[0] as NodeId;
        const start = active.starts[id] as Box;
        const placement = lastDoc?.widgets[id];
        const keepAspect =
          (placement !== undefined && registry.widgetTraits(placement.widget).keepsAspect) !==
          (modifiers.shift === true);
        const handle = active.handle as ResizeHandle;
        let box = resizeBox(start, handle, delta, { keepAspect, minSize: MIN_NODE_SIZE });
        let lines: Guide[] = [];
        if (snapping && !keepAspect && start.rotation === 0) {
          const snapped = snapResize(box, handle, active.targets, active.snapDistance, MIN_NODE_SIZE);
          box = snapped.box;
          lines = snapped.guides;
        }
        transientBoxes = { [id]: box };
        guides = lines;
        break;
      }
      case "rotate": {
        const id = active.ids[0] as NodeId;
        const start = active.starts[id] as Box;
        const rotation = rotationAt(centerOf(start), active.startPoint, at, start.rotation, modifiers.shift === true);
        transientBoxes = { [id]: { ...start, rotation } };
        guides = [];
        break;
      }
    }
    emit();
  }

  function endGesture(): CommandResult {
    const active = gesture;
    const boxes = transientBoxes;
    if (active === null || boxes === null) {
      return refuse("no gesture is in progress");
    }
    clearGesture();
    const moved = active.ids.filter((id) => !sameBox(boxes[id] as Box, active.starts[id] as Box));
    if (moved.length === 0) {
      emit();
      return { ok: true };
    }
    // One change for the whole gesture, so it is one undo and one op on the wire.
    return editPlacements(moved, (placement, id) => {
      const box = boxes[id] as Box;
      return { ...placement, x: box.x, y: box.y, width: box.width, height: box.height, rotation: box.rotation };
    });
  }

  function cancelGesture(): void {
    if (gesture === null) {
      return;
    }
    clearGesture();
    emit();
  }

  function clearGesture(): void {
    gesture = null;
    transientBoxes = null;
    guides = [];
  }

  // -------------------------------------------------------------------------
  // Viewport

  function screenToCanvas(point: Point): Point {
    return { x: (point.x - viewport.origin.x) / viewport.zoom, y: (point.y - viewport.origin.y) / viewport.zoom };
  }

  function canvasToScreen(point: Point): Point {
    return { x: point.x * viewport.zoom + viewport.origin.x, y: point.y * viewport.zoom + viewport.origin.y };
  }

  function setZoom(zoom: number, fit: boolean): void {
    assert(Number.isFinite(zoom) && zoom > 0, "a zoom is a positive number");
    viewport = { ...viewport, zoom, fit };
    emit();
  }

  // -------------------------------------------------------------------------
  // Commands

  function dispatch(command: CommandId, args: Record<string, unknown> = {}): CommandResult {
    assert(COMMAND_IDS.includes(command), `"${command}" is not a command`);
    switch (command) {
      case "selection.select": {
        assert(typeof args.id === "string", "selection.select takes an id");
        select(args.id, args.additive === true);
        return { ok: true };
      }
      case "selection.clear":
        setSelection([]);
        return { ok: true };
      case "selection.all":
        setSelection(lastDoc === null ? [] : stackOrder(lastDoc));
        return { ok: true };
      case "gesture.cancel":
        cancelGesture();
        return { ok: true };
      case "view.zoomIn":
        setZoom(zoomIn(viewport.zoom), false);
        return { ok: true };
      case "view.zoomOut":
        setZoom(zoomOut(viewport.zoom), false);
        return { ok: true };
      case "view.zoomFit":
        setZoom(viewport.fitZoom, true);
        return { ok: true };
      case "clipboard.copy": {
        const copied = copySelection();
        if (copied === null) {
          return refuse("nothing is selected");
        }
        clipboard = copied;
        return { ok: true };
      }
      case "history.undo":
        return undo();
      case "history.redo":
        return redo();
      default:
        break;
    }
    const block = blocked();
    if (block !== null) {
      return refuse(block);
    }
    switch (command) {
      case "node.delete":
        return removeNodes(selectedIds());
      case "node.toggleVisible":
        return toggleField("visible");
      case "node.toggleLock":
        return toggleField("locked");
      case "node.nudge": {
        const dx = typeof args.dx === "number" ? args.dx : 0;
        const dy = typeof args.dy === "number" ? args.dy : 0;
        return nudge(dx, dy);
      }
      case "node.duplicate": {
        const copied = copySelection();
        return copied === null ? refuse("nothing is selected") : pasteCopies(copied, PASTE_OFFSET);
      }
      case "clipboard.cut": {
        const copied = copySelection();
        if (copied === null) {
          return refuse("nothing is selected");
        }
        clipboard = copied;
        return removeNodes(copied.placements.map(({ id }) => id));
      }
      case "clipboard.paste": {
        if (clipboard === null) {
          return refuse("the clipboard is empty");
        }
        clipboard = { ...clipboard, pastes: clipboard.pastes + 1 };
        return pasteCopies(clipboard, PASTE_OFFSET * clipboard.pastes);
      }
      case "layer.bringForward":
      case "layer.sendBackward":
      case "layer.toFront":
      case "layer.toBack":
        return layerCommand(command);
      case "canvas.patch":
        return patchCanvas(args as CanvasPatch);
    }
    throw new Error(`composition editor: command "${command}" has no handler`);
  }

  function handleKey(input: KeyInput): boolean {
    const binding = bindingFor(keymap, chordOf(input));
    if (binding === null) {
      return false;
    }
    if (binding.command === "selection.clear") {
      if (gesture !== null) {
        cancelGesture();
        return true;
      }
      // Clearing nothing is not a use of the key: Escape goes on to whatever else listens for it.
      if (selection.length === 0) {
        return false;
      }
    }
    return dispatch(binding.command, binding.args).ok;
  }

  // -------------------------------------------------------------------------
  // Preview

  let frameCache: { state: EditorState; frame: PreviewFrame } | null = null;

  function frame(): PreviewFrame | null {
    if (state.doc === null) {
      return null;
    }
    if (frameCache !== null && frameCache.state === state) {
      return frameCache.frame;
    }
    let doc = state.doc;
    if (state.transient !== null) {
      const widgets = { ...doc.widgets };
      for (const [id, box] of Object.entries(state.transient.boxes)) {
        const placement = widgets[id];
        if (placement !== undefined) {
          widgets[id] = {
            ...placement,
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            rotation: box.rotation,
          };
        }
      }
      doc = { ...doc, widgets };
    }
    const built: PreviewFrame = {
      doc,
      order: state.view.nodes.map((node) => node.id),
      playheadMs: state.timeline.playheadMs,
      playing: state.timeline.playing,
    };
    frameCache = { state, frame: built };
    return built;
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch,
    handleKey,
    setCatalog,
    canvas: { patch: patchCanvas },
    gesture: { begin: beginGesture, update: updateGesture, end: endGesture, cancel: cancelGesture },
    nodes: {
      add: addNode,
      patch: patchNode,
      resize: resizeNode,
      moveCenter: moveNodeCenter,
      reorder: (id, to) => reorderNode(id, to.index),
      remove: removeNodes,
    },
    behaviors: {
      add: addBehavior,
      patch: patchBehavior,
      remove: removeBehavior,
      reorder: (id, to) => reorderBehavior(id, to.index),
    },
    history: { undo, redo },
    viewport: {
      setStage(size) {
        viewport = { ...viewport, stage: { width: size.width, height: size.height } };
        emit();
      },
      setOrigin(origin) {
        viewport = { ...viewport, origin: { x: origin.x, y: origin.y } };
        emit();
      },
      setZoom: (zoom) => setZoom(zoom, false),
      screenToCanvas,
      canvasToScreen,
    },
    timeline: {
      seek(ms) {
        assert(Number.isFinite(ms), "a playhead is a finite time");
        playhead = { ...playhead, playheadMs: Math.max(0, ms) };
        emit();
      },
      play() {
        playhead = { ...playhead, playing: true };
        emit();
      },
      pause() {
        playhead = { ...playhead, playing: false };
        emit();
      },
      advance(ms) {
        if (!playhead.playing) {
          return;
        }
        playhead = { ...playhead, playheadMs: Math.max(0, playhead.playheadMs + ms) };
        emit();
      },
    },
    preview: {
      frame,
      layoutMessage(messageOptions) {
        const current = frame();
        return current === null ? null : buildPreviewLayoutMessage(current, messageOptions);
      },
    },
    destroy() {
      unsubscribe();
      listeners.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers

function boxOf(placement: PlacementDocument): Box {
  return {
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
    rotation: placement.rotation,
  };
}

function unionOf(boxes: readonly Box[]): Box {
  assert(boxes.length > 0, "a union needs a box");
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top, rotation: 0 };
}

/** `box` with its centre at `center`, unrounded: snapping works on the exact position, rounding comes after. */
function withCenterExact(box: Box, center: Point): Box {
  return { ...box, x: center.x - box.width / 2, y: center.y - box.height / 2 };
}

function keyAfter(last: string | null): string {
  try {
    return keyBetween(last, null);
  } catch {
    return `${last ?? ""}i`;
  }
}

function randomBehaviorId(taken: ReadonlySet<string>): string {
  return `b-${randomNodeId(taken).slice(2)}`;
}

function sameList(a: readonly string[] | undefined, b: readonly string[]): boolean {
  return a !== undefined && a.length === b.length && a.every((item, i) => item === b[i]);
}

function sameSize(a: CanvasSize | null, b: CanvasSize | null): boolean {
  return a === b || (a !== null && b !== null && a.width === b.width && a.height === b.height);
}

function sameBox(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.rotation === b.rotation;
}

function sameBoxes(a: Readonly<Record<string, Box>>, b: Readonly<Record<string, Box>>): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => b[key] !== undefined && sameBox(a[key] as Box, b[key] as Box))
  );
}

function sameGuides(a: readonly Guide[], b: readonly Guide[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (guide, i) => guide.axis === b[i]?.axis && guide.position === b[i]?.position && guide.source === b[i]?.source
    )
  );
}

function samePeers(a: readonly Peer[], b: readonly Peer[]): boolean {
  return (
    a.length === b.length &&
    a.every((peer, i) => peer.id === b[i]?.id && peer.name === b[i]?.name && peer.selection === b[i]?.selection)
  );
}

function sameViewport(a: ViewportState, b: ViewportState): boolean {
  return (
    a.zoom === b.zoom &&
    a.fit === b.fit &&
    a.fitZoom === b.fitZoom &&
    sameSize(a.stage, b.stage) &&
    a.origin.x === b.origin.x &&
    a.origin.y === b.origin.y
  );
}
