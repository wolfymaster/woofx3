// Behaviors the page hands to a widget to play itself.
//
// The scene runtime plays the host's own transition and effect kinds on a
// widget's box, and plans any other kind the widget declares as a delegation
// (see @woofx3/scene's runtime/plan.ts): the widget animates its own content.
// A kind the widget does not declare is skipped before it gets here. This
// turns those delegations into the widget protocol's `behavior` message (see
// module-sdk's widget-behaviors.ts).
//
// The shim holds one transition and one effect at a time and can only clear
// both at once, so the relay remembers what each widget is playing: when one
// behavior is withdrawn, the widget is cleared and told again about the
// ones still playing.

import { isHostKind } from "@woofx3/scene/model";
import type { BehaviorId, CompositionDocument, NodeId } from "@woofx3/scene/model";
import type { DelegatedBehavior, DelegateRequest } from "@woofx3/scene/runtime";
import type { WidgetBehaviorState } from "@woofx3/module-sdk";
import { sameValue } from "@woofx3/scene/model";

/**
 * What the widget is told for a delegation, or null for one the protocol
 * cannot carry: a type other than transition or effect, or a transition with
 * no phase, which validation refuses and a merged document could still hold.
 */
export function behaviorStateOf(delegated: DelegatedBehavior): WidgetBehaviorState | null {
  const durationMs = delegated.endMs === null ? null : Math.max(0, delegated.endMs - delegated.startMs);
  if (delegated.type === "transition") {
    if (delegated.phase === null) {
      return null;
    }
    return {
      type: "transition",
      kind: delegated.kind,
      phase: delegated.phase,
      durationMs,
      easing: delegated.easing,
      params: delegated.params,
    };
  }
  if (delegated.type === "effect") {
    return { type: "effect", kind: delegated.kind, durationMs, easing: delegated.easing, params: delegated.params };
  }
  return null;
}

/**
 * The widget's own entrance, to mark its frame with from boot: the first
 * in-transition on it, by order, whose kind the host does not play and the
 * widget `declares`. The runtime hands the same transition over again as the
 * widget enters, which restarts it then; marking it at boot is what keeps the
 * content from showing whole until that message arrives.
 */
export function entranceOf(
  doc: CompositionDocument,
  widgetId: NodeId,
  declares: (type: string, kind: string) => boolean
): WidgetBehaviorState | null {
  const entrances = Object.entries(doc.behaviors)
    .filter(
      ([, behavior]) =>
        behavior.type === "transition" &&
        behavior.target === widgetId &&
        behavior.params.phase === "in" &&
        !isHostKind(behavior.type, behavior.kind) &&
        declares(behavior.type, behavior.kind)
    )
    .sort(([aId, a], [bId, b]) => compareText(a.order, b.order) || compareText(aId, bId));
  const first = entrances[0];
  if (first === undefined) {
    return null;
  }
  const [, behavior] = first;
  return {
    type: "transition",
    kind: behavior.kind,
    phase: "in",
    durationMs: typeof behavior.timing.durationMs === "number" ? behavior.timing.durationMs : null,
    easing: behavior.timing.easing,
    params: behavior.params,
  };
}

interface Playing {
  state: WidgetBehaviorState;
  startMs: number;
}

/** Sends delegations on to widgets as `behavior` messages, keeping what each one plays. */
export class BehaviorRelay {
  private readonly playing = new Map<NodeId, Map<BehaviorId, Playing>>();

  constructor(private readonly send: (widgetId: NodeId, state: WidgetBehaviorState | null) => void) {}

  /** The renderer's `onDelegate`. */
  handle(widgetId: NodeId, request: DelegateRequest): void {
    if (request.kind === "start") {
      this.start(widgetId, request.delegated);
    } else {
      this.cancel(widgetId, request.behavior);
    }
  }

  /** The widget is gone; what it played goes with it. */
  forget(widgetId: NodeId): void {
    this.playing.delete(widgetId);
  }

  /**
   * What a frame swapped in for the widget's last one is told: the effects it
   * plays until they are withdrawn. A transition has played by then, and
   * playing it again on every settings change would replay an entrance.
   */
  ongoing(widgetId: NodeId): WidgetBehaviorState[] {
    return [...(this.playing.get(widgetId)?.values() ?? [])]
      .filter(({ state }) => state.type === "effect" && state.durationMs === null)
      .map(({ state }) => state);
  }

  private start(widgetId: NodeId, delegated: DelegatedBehavior): void {
    const state = behaviorStateOf(delegated);
    if (state === null) {
      console.warn("[scene-manager] a widget behavior the protocol cannot carry; skipped", {
        widgetId,
        behavior: delegated.behavior,
      });
      return;
    }
    let widget = this.playing.get(widgetId);
    if (widget === undefined) {
      widget = new Map();
      this.playing.set(widgetId, widget);
    }
    const previous = widget.get(delegated.behavior);
    widget.set(delegated.behavior, { state, startMs: delegated.startMs });
    // An open-ended behavior's end becomes known once its widget's exit is:
    // telling the widget again would restart it partway through.
    if (previous !== undefined && previous.startMs === delegated.startMs && sameExceptDuration(previous.state, state)) {
      return;
    }
    this.send(widgetId, state);
  }

  private cancel(widgetId: NodeId, behavior: BehaviorId): void {
    const widget = this.playing.get(widgetId);
    if (widget === undefined || !widget.delete(behavior)) {
      return;
    }
    this.send(widgetId, null);
    for (const type of ["transition", "effect"] as const) {
      const latest = [...widget.values()]
        .filter(({ state }) => state.type === type)
        .sort((a, b) => b.startMs - a.startMs)[0];
      if (latest !== undefined) {
        this.send(widgetId, latest.state);
      }
    }
  }
}

function sameExceptDuration(a: WidgetBehaviorState, b: WidgetBehaviorState): boolean {
  return (
    a.type === b.type &&
    a.kind === b.kind &&
    a.phase === b.phase &&
    a.easing === b.easing &&
    sameValue(a.params, b.params)
  );
}

function compareText(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
