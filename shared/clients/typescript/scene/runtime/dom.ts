// Applies render-plan patches (see diff.ts) to the page.
//
// Each widget is a stack of elements, outermost first:
//
//   box                position, size, rotation, opacity, stacking, visibility
//   > transition       entrance and exit animations
//     > effect         effects that play while the widget is shown
//       > slot         the widget's content, mounted by the caller
//
// The box is written only when the plan changes. It is placed with
// `transform` rather than `left`/`top`, so moving a widget never triggers
// layout and a rotation turns it about its centre. Animations never touch the
// box; each wrapper animates only its layer's compositor properties (see
// LAYER_PROPERTIES), so a transition and an effect playing at once compose
// instead of overwriting each other.
//
// Every widget box sits inside a canvas root with the same two wrappers, which
// play the behaviors that target the whole canvas.
//
// Every animation shares one origin on the document timeline, the moment the
// composition was at 0 ms, and keeps its planned start as its `delay`. A
// running animation's `currentTime` is therefore the composition's time, and
// seeking is setting it, which is how the editor scrubs.
//
// The renderer does not create content: `mountContent` puts a widget's frame
// in its slot, so frame creation, the widget bridge and hot-swapping on
// settings changes stay with the page that owns them.

import type { AnimationKeyframe } from "../model/animation";
import type { NodeId } from "../model/types";
import type { AnimationOwner, PatchOp } from "./diff";
import type { BoxState, DelegatedBehavior } from "./plan";

/** The slice of an `Animation` the renderer drives. */
export interface RenderAnimation {
  startTime: CSSNumberish | null;
  currentTime: CSSNumberish | null;
  pause(): void;
  cancel(): void;
}

/** The style properties the renderer writes. */
export interface RenderStyle {
  position: string;
  left: string;
  top: string;
  width: string;
  height: string;
  transform: string;
  transformOrigin: string;
  opacity: string;
  zIndex: string;
  visibility: string;
}

/**
 * The slice of an `HTMLElement` the renderer uses; a real element satisfies
 * it. Parameterised by its own type because the DOM only appends nodes.
 */
export interface RenderElement<TChild = unknown> {
  readonly style: RenderStyle;
  appendChild(child: TChild): unknown;
  remove(): void;
  setAttribute(name: string, value: string): void;
  animate(keyframes: Keyframe[], options: KeyframeAnimationOptions): RenderAnimation;
}

export interface RenderDocument<TElement extends RenderElement<TElement>> {
  createElement(tag: "div"): TElement;
  /** The document timeline (`document.timeline`), the clock animations run on. */
  readonly timeline: { readonly currentTime: CSSNumberish | null };
}

/** What a delegation op asks of the widget; the caller sends it over the widget protocol. */
export type DelegateRequest = { kind: "start"; delegated: DelegatedBehavior } | { kind: "cancel"; behavior: string };

export interface DomRendererOptions<TElement extends RenderElement<TElement>> {
  document: RenderDocument<TElement>;
  /** Where the canvas root goes: the scene's widget layer, or an alert's stage. */
  root: TElement;
  /**
   * Put a widget's content in `slot`. Returns what to run when the widget is
   * unmounted (tear the frame and its bridge down).
   */
  mountContent(slot: TElement, widgetId: NodeId, widget: string): () => void;
  /** A behavior the widget plays itself starts or is withdrawn. */
  onDelegate?(widgetId: NodeId, request: DelegateRequest): void;
  /** The composition time at creation; the renderer starts playing from it. */
  atMs?: number;
}

export interface DomRenderer<TElement> {
  apply(ops: readonly PatchOp[]): void;
  /** Move every animation to composition time `ms`, playing or paused as before. */
  seek(ms: number): void;
  pause(): void;
  /** Resume from where it is paused, with the composition clock running again. */
  play(): void;
  /** The composition time the animations are showing. */
  timeMs(): number;
  /** A widget's box, for hit-testing and the editor's overlays; `undefined` when not mounted. */
  boxOf(widgetId: NodeId): TElement | undefined;
  /** Unmount every widget and remove the canvas root. */
  dispose(): void;
}

interface Wrappers<TElement> {
  transition: TElement;
  effect: TElement;
  /** What plays on these wrappers, by `{layer}:{behavior}`. */
  animations: Map<string, RenderAnimation>;
}

interface MountedWidget<TElement> extends Wrappers<TElement> {
  box: TElement;
  unmountContent: () => void;
  /** The last value written to each box property, so an unchanged one is not written again. */
  written: Partial<Record<keyof RenderStyle, string>>;
}

export function createDomRenderer<TElement extends RenderElement<TElement>>(
  options: DomRendererOptions<TElement>
): DomRenderer<TElement> {
  const doc = options.document;
  const widgets = new Map<NodeId, MountedWidget<TElement>>();

  // While playing, the document-timeline time at which the composition was
  // at 0 ms; while paused, the composition time held.
  let playing = true;
  let origin = timelineNow() - (options.atMs ?? 0);
  let pausedAtMs = 0;

  const canvasTransition = fill(doc.createElement("div"));
  const canvasEffect = fill(doc.createElement("div"));
  const layer = fill(doc.createElement("div"));
  canvasTransition.setAttribute("data-scene-layer", "canvas-transition");
  canvasEffect.setAttribute("data-scene-layer", "canvas-effect");
  layer.setAttribute("data-scene-layer", "widgets");
  canvasEffect.appendChild(layer);
  canvasTransition.appendChild(canvasEffect);
  options.root.appendChild(canvasTransition);
  const canvas: Wrappers<TElement> = { transition: canvasTransition, effect: canvasEffect, animations: new Map() };

  function timelineNow(): number {
    const now = doc.timeline.currentTime;
    if (typeof now !== "number") {
      throw new Error("runtime: the document timeline is not running");
    }
    return now;
  }

  function* allAnimations(): Iterable<RenderAnimation> {
    yield* canvas.animations.values();
    for (const widget of widgets.values()) {
      yield* widget.animations.values();
    }
  }

  function wrappersOf(id: AnimationOwner): Wrappers<TElement> {
    if (id === null) {
      return canvas;
    }
    return mustGet(id);
  }

  function mustGet(id: NodeId): MountedWidget<TElement> {
    const widget = widgets.get(id);
    if (widget === undefined) {
      throw new Error(`runtime: widget ${id} is not mounted`);
    }
    return widget;
  }

  function writeStyle(widget: MountedWidget<TElement>, property: keyof RenderStyle, value: string): void {
    if (widget.written[property] === value) {
      return;
    }
    widget.written[property] = value;
    widget.box.style[property] = value;
  }

  function writeBox(widget: MountedWidget<TElement>, box: BoxState): void {
    writeStyle(widget, "transform", `translate(${box.x}px, ${box.y}px) rotate(${box.rotation}deg)`);
    writeStyle(widget, "width", `${box.width}px`);
    writeStyle(widget, "height", `${box.height}px`);
    writeStyle(widget, "opacity", String(box.opacity));
  }

  function mount(op: Extract<PatchOp, { op: "mount" }>): void {
    if (widgets.has(op.id)) {
      throw new Error(`runtime: widget ${op.id} is already mounted`);
    }
    const box = doc.createElement("div");
    box.setAttribute("data-scene-widget", op.id);
    box.style.position = "absolute";
    box.style.left = "0";
    box.style.top = "0";
    box.style.transformOrigin = "50% 50%";
    const transition = fill(doc.createElement("div"));
    const effect = fill(doc.createElement("div"));
    const slot = fill(doc.createElement("div"));
    effect.appendChild(slot);
    transition.appendChild(effect);
    box.appendChild(transition);
    const widget: MountedWidget<TElement> = {
      box,
      transition,
      effect,
      animations: new Map(),
      unmountContent: () => {},
      written: {},
    };
    writeBox(widget, op.box);
    writeStyle(widget, "zIndex", String(op.z));
    writeStyle(widget, "visibility", op.visible ? "" : "hidden");
    // In the page before its content mounts: a frame loads only once attached.
    layer.appendChild(box);
    widgets.set(op.id, widget);
    widget.unmountContent = options.mountContent(slot, op.id, op.widget);
  }

  function unmount(id: NodeId): void {
    const widget = mustGet(id);
    for (const animation of widget.animations.values()) {
      animation.cancel();
    }
    widget.animations.clear();
    widgets.delete(id);
    widget.unmountContent();
    widget.box.remove();
  }

  function startAnimation(op: Extract<PatchOp, { op: "startAnimation" }>): void {
    const wrappers = wrappersOf(op.id);
    const key = `${op.layer}:${op.behavior}`;
    if (wrappers.animations.has(key)) {
      throw new Error(`runtime: behavior ${op.behavior} is already animating; cancel it first`);
    }
    const animation = wrappers[op.layer].animate(domKeyframes(op.spec.keyframes), { ...op.spec.timing });
    if (playing) {
      animation.startTime = origin;
    } else {
      animation.pause();
      animation.currentTime = pausedAtMs;
    }
    wrappers.animations.set(key, animation);
  }

  function cancelAnimation(op: Extract<PatchOp, { op: "cancelAnimation" }>): void {
    const wrappers = wrappersOf(op.id);
    const key = `${op.layer}:${op.behavior}`;
    const animation = wrappers.animations.get(key);
    if (animation === undefined) {
      throw new Error(`runtime: no animation for behavior ${op.behavior} to cancel`);
    }
    animation.cancel();
    wrappers.animations.delete(key);
  }

  return {
    apply(ops) {
      for (const op of ops) {
        switch (op.op) {
          case "unmount":
            unmount(op.id);
            break;
          case "mount":
            mount(op);
            break;
          case "setBox":
            writeBox(mustGet(op.id), op.box);
            break;
          case "setStack":
            writeStyle(mustGet(op.id), "zIndex", String(op.z));
            break;
          case "setVisible":
            writeStyle(mustGet(op.id), "visibility", op.visible ? "" : "hidden");
            break;
          case "startAnimation":
            startAnimation(op);
            break;
          case "cancelAnimation":
            cancelAnimation(op);
            break;
          case "delegate":
            mustGet(op.id);
            options.onDelegate?.(op.id, { kind: "start", delegated: op.delegated });
            break;
          case "cancelDelegate":
            mustGet(op.id);
            options.onDelegate?.(op.id, { kind: "cancel", behavior: op.behavior });
            break;
          default:
            throw new Error(`runtime: unknown patch op ${JSON.stringify(op)}`);
        }
      }
    },

    seek(ms) {
      if (!Number.isFinite(ms)) {
        throw new Error("runtime: seek needs a finite time");
      }
      if (playing) {
        origin = timelineNow() - ms;
      } else {
        pausedAtMs = ms;
      }
      for (const animation of allAnimations()) {
        animation.currentTime = ms;
      }
    },

    pause() {
      if (!playing) {
        return;
      }
      pausedAtMs = timelineNow() - origin;
      playing = false;
      for (const animation of allAnimations()) {
        animation.pause();
        animation.currentTime = pausedAtMs;
      }
    },

    play() {
      if (playing) {
        return;
      }
      origin = timelineNow() - pausedAtMs;
      playing = true;
      // Setting a start time resumes a paused animation on the shared origin.
      for (const animation of allAnimations()) {
        animation.startTime = origin;
      }
    },

    timeMs() {
      return playing ? timelineNow() - origin : pausedAtMs;
    },

    boxOf(widgetId) {
      return widgets.get(widgetId)?.box;
    },

    dispose() {
      for (const id of [...widgets.keys()]) {
        unmount(id);
      }
      for (const animation of canvas.animations.values()) {
        animation.cancel();
      }
      canvas.animations.clear();
      canvasTransition.remove();
    },
  };
}

/** The DOM's `Keyframe` takes any property; the copies widen the plan's narrower frames to it. */
function domKeyframes(frames: readonly AnimationKeyframe[]): Keyframe[] {
  return frames.map((frame) => ({ ...frame }));
}

/** A wrapper that fills its parent, so the box's size is the content's size. */
function fill<T extends RenderElement<T>>(element: T): T {
  element.style.position = "absolute";
  element.style.left = "0";
  element.style.top = "0";
  element.style.width = "100%";
  element.style.height = "100%";
  return element;
}
