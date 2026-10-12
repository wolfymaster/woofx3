// The writes that take the page from one render plan to the next.
//
// The overlay re-plans whenever a fact arrives or a planned time passes, and
// most of each plan is the same as the last. `diffPlans` compares the two and
// returns only what changed, so the page never rewrites a style it already
// has, never restarts an animation that is playing as planned, and never
// remounts a frame (a remount reloads the widget).
//
// Ops come in the order they must be applied: removals first, then mounts,
// then box, stacking and visibility writes, then animation cancels before
// starts, so a restarted animation never briefly composes with its old self.

import type { AnimationSpec, HostLayer } from "../model/animation";
import type { BehaviorId, NodeId } from "../model/types";
import type { BoxState, DelegatedBehavior, LayerAnimations, PlannedAnimation, RenderPlan, WidgetPlan } from "./plan";

/** Which element an animation plays on: a widget's wrapper, or the canvas root's (`id: null`). */
export type AnimationOwner = NodeId | null;

export type PatchOp =
  | { op: "unmount"; id: NodeId }
  | { op: "mount"; id: NodeId; widget: string; box: BoxState; z: number; visible: boolean }
  | { op: "setBox"; id: NodeId; box: BoxState }
  | { op: "setStack"; id: NodeId; z: number }
  | { op: "setVisible"; id: NodeId; visible: boolean }
  | { op: "cancelAnimation"; id: AnimationOwner; layer: HostLayer; behavior: BehaviorId }
  | { op: "startAnimation"; id: AnimationOwner; layer: HostLayer; behavior: BehaviorId; spec: AnimationSpec }
  | { op: "cancelDelegate"; id: NodeId; behavior: BehaviorId }
  | { op: "delegate"; id: NodeId; delegated: DelegatedBehavior };

const LAYERS: readonly HostLayer[] = ["transition", "effect"];

const EMPTY_LAYERS: LayerAnimations = { transition: [], effect: [] };

/** The ops that turn the page showing `prev` (or nothing) into `next`. */
export function diffPlans(prev: RenderPlan | null, next: RenderPlan): PatchOp[] {
  const removals: PatchOp[] = [];
  const mounts: PatchOp[] = [];
  const writes: PatchOp[] = [];
  const cancels: PatchOp[] = [];
  const starts: PatchOp[] = [];
  const delegates: PatchOp[] = [];

  const before = prev?.widgets ?? {};
  for (const id of Object.keys(before)) {
    const after = next.widgets[id];
    if (after === undefined || after.widget !== before[id].widget) {
      // Unmounting takes the widget's animations and delegations with it.
      removals.push({ op: "unmount", id });
    }
  }

  for (const [id, widget] of Object.entries(next.widgets)) {
    const old = before[id];
    const mounted = old !== undefined && old.widget === widget.widget;
    if (!mounted) {
      mounts.push({ op: "mount", id, widget: widget.widget, box: widget.box, z: widget.z, visible: widget.visible });
    } else {
      if (!sameBox(old.box, widget.box)) {
        writes.push({ op: "setBox", id, box: widget.box });
      }
      if (old.z !== widget.z) {
        writes.push({ op: "setStack", id, z: widget.z });
      }
      if (old.visible !== widget.visible) {
        writes.push({ op: "setVisible", id, visible: widget.visible });
      }
    }
    diffAnimations(id, mounted ? old.animations : EMPTY_LAYERS, widget.animations, cancels, starts);
    diffDelegates(id, mounted ? old : null, widget, delegates);
  }

  diffAnimations(null, prev?.canvas.animations ?? EMPTY_LAYERS, next.canvas.animations, cancels, starts);
  return [...removals, ...mounts, ...writes, ...cancels, ...starts, ...delegates];
}

/**
 * Animations on one wrapper compose in the order they were started, so a
 * list is kept in step by its longest unchanged prefix: everything after the
 * first difference is cancelled and started again in plan order. Adding a
 * behavior at the end starts one animation; changing one restarts it and
 * those composed above it.
 */
function diffAnimations(
  id: AnimationOwner,
  prev: LayerAnimations,
  next: LayerAnimations,
  cancels: PatchOp[],
  starts: PatchOp[]
): void {
  for (const layer of LAYERS) {
    const old = prev[layer];
    const now = next[layer];
    let kept = 0;
    while (kept < old.length && kept < now.length && sameAnimation(old[kept], now[kept])) {
      kept += 1;
    }
    for (const animation of old.slice(kept)) {
      cancels.push({ op: "cancelAnimation", id, layer, behavior: animation.behavior });
    }
    for (const animation of now.slice(kept)) {
      starts.push({ op: "startAnimation", id, layer, behavior: animation.behavior, spec: animation.spec });
    }
  }
}

function diffDelegates(id: NodeId, prev: WidgetPlan | null, next: WidgetPlan, out: PatchOp[]): void {
  const old = new Map((prev?.delegated ?? []).map((entry) => [entry.behavior, entry]));
  const current = new Set(next.delegated.map((entry) => entry.behavior));
  for (const behavior of old.keys()) {
    if (!current.has(behavior)) {
      out.push({ op: "cancelDelegate", id, behavior });
    }
  }
  for (const entry of next.delegated) {
    const previous = old.get(entry.behavior);
    if (previous === undefined || !sameValue(previous, entry)) {
      out.push({ op: "delegate", id, delegated: entry });
    }
  }
}

function sameBox(a: BoxState, b: BoxState): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.rotation === b.rotation &&
    a.opacity === b.opacity
  );
}

function sameAnimation(a: PlannedAnimation, b: PlannedAnimation): boolean {
  return a.behavior === b.behavior && sameValue(a.spec, b.spec);
}

/** Structural equality over plain data; numbers by `Object.is`, so infinities compare. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  const bRecord = b as Record<string, unknown>;
  const aRecord = a as Record<string, unknown>;
  return aKeys.every((key) => Object.hasOwn(bRecord, key) && sameValue(aRecord[key], bRecord[key]));
}
