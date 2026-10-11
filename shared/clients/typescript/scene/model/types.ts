// The composition: the document behind both a scene and an alert.
//
// A composition is a canvas (`layout`), the widgets placed on it, and the
// behaviors that act on them. A scene and an alert have the same structure;
// they differ only in their profile: how long they live, where they are
// stored, and which widgets they accept.
//
// Every collection is a map keyed by id, never a list, so concurrent edits to
// different entries touch different json0 paths and never need resolving.
//
// This file is the contract the model, the sync layer, the editor and the
// overlay runtime share. The type registry (see registry.ts) decides what a
// valid entry of each collection looks like.

/** Id of a placed widget, the key in `widgets`. */
export type NodeId = string;

/** Id of a behavior, the key in `behaviors`. */
export type BehaviorId = string;

/** A behavior target that is the whole canvas rather than one widget. */
export const CANVAS_TARGET = "canvas";

/**
 * One placed widget. Placements are keyed by id, so moving or editing one
 * never shifts another's path.
 */
export interface PlacementDocument {
  /** The widget's canonical id, `{moduleId}:widget:{manifestId}`. */
  widget: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  /** Stacking, bottom first, as a key that sorts as text (see `keyBetween`). */
  z: string;
  settings: Record<string, unknown>;
  name: string;
  /** Degrees clockwise about the placement's centre. */
  rotation: number;
  /** 0 (transparent) to 1 (opaque), as CSS takes it. */
  opacity: number;
  locked: boolean;
  /** Any other field a placement was stored with, kept as it was. */
  extra: Record<string, unknown>;
}

/**
 * What a behavior's timing is measured from.
 *
 * - `start` / `end`: the composition starts or ends (an alert starts playing,
 *   or every timed widget has finished).
 * - `enter` / `exit`: the target becomes active or inactive (shown, added,
 *   hidden, removed, or its activity window opens or closes).
 * - `complete`: a widget reports it has finished (`Timing.node`, else the
 *   target).
 */
export type AnchorKind = "start" | "end" | "enter" | "exit" | "complete";

export const ANCHOR_KINDS: readonly AnchorKind[] = ["start", "end", "enter", "exit", "complete"];

export type Easing = "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out";

export const EASINGS: readonly Easing[] = ["linear", "ease", "ease-in", "ease-out", "ease-in-out"];

/**
 * When a behavior runs, relative to an anchor rather than a fixed time: an
 * alert's length is only known once it plays (a video's length, a widget
 * calling `complete()`).
 */
export interface Timing {
  anchor: AnchorKind;
  /** For `complete`: the widget whose completion counts. Absent means the target. */
  node?: NodeId;
  /** Milliseconds after the anchor; negative runs before an `exit` or `end`. */
  offsetMs: number;
  /** How long it runs, or until the target exits. */
  durationMs: number | "until-exit";
  easing: Easing;
}

/**
 * Something that acts on a widget, or on the whole canvas, without the
 * widget knowing about it.
 *
 * Registered types:
 * - `transition`: plays as its target enters or exits (`params.phase`).
 * - `effect`: modifies its target for a window of time.
 * - `activity`: the window in which its target is active within the
 *   composition, for example a text that enters 500 ms after an alert starts.
 */
export interface BehaviorDocument {
  type: string;
  /** What exactly: `fade`, `slide`, `shake`, or an id the widget declares. */
  kind: string;
  target: NodeId | typeof CANVAS_TARGET;
  /** Order among the behaviors on one target, as a key that sorts as text. */
  order: string;
  timing: Timing;
  params: Record<string, unknown>;
}

/**
 * A value a composition takes from whoever uses it: the step that links an
 * alert fills these in. The shape is the engine's `ConfigField`, so step forms
 * render inputs with the existing field renderers.
 */
export interface InputField {
  id: string;
  label: string;
  type: string;
  description?: string;
  defaultValue?: unknown;
  [key: string]: unknown;
}

/**
 * Where an input's value goes inside the document: a whole value, which keeps
 * the input's type. Inside text, `{{id}}` is replaced instead.
 */
export interface InputReference {
  $input: string;
}

/** The composition a derived composition builds on (reserved, not yet used). */
export interface CompositionBase {
  id: string;
  version: string;
}

export interface CompositionDocument {
  /** The canvas: `width`, `height`, `backgroundColor`, and any other keys. */
  layout: Record<string, unknown>;
  widgets: Record<NodeId, PlacementDocument>;
  behaviors: Record<BehaviorId, BehaviorDocument>;
  inputs?: InputField[];
  base?: CompositionBase;
}

/** Which kind of composition: a persistent scene, or a bounded alert. */
export type ProfileId = "scene" | "alert";

/**
 * What differs between a scene and an alert. The editor exposes these as
 * capabilities, so the UI asks "is there a timeline" rather than "is this an
 * alert".
 */
export interface CompositionProfile {
  id: ProfileId;
  /** The widget surface a placement's widget must declare. */
  surface: ProfileId;
  /** Whether the composition ends by itself (an alert) or runs until changed. */
  bounded: boolean;
  /** The anchors timing may use in this profile. */
  anchors: readonly AnchorKind[];
}

export const PROFILES: Readonly<Record<ProfileId, CompositionProfile>> = {
  scene: { id: "scene", surface: "scene", bounded: false, anchors: ["enter", "exit", "complete"] },
  alert: { id: "alert", surface: "alert", bounded: true, anchors: ["start", "end", "enter", "exit", "complete"] },
};
