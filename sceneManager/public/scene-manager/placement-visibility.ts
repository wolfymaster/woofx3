// How a placement shows that a workflow step hid it.
//
// Hidden, not removed: the frame keeps running, so a widget shown again comes
// back at once and as it was, with its state and timers intact, rather than
// loading from scratch on stream. `visibility` rather than `display`, which
// the editor's live layout owns (see preview-layout.ts).
//
// The editor frames the overlay to place widgets, and cannot place one it
// cannot see, so there a hidden placement is dimmed instead.

export const DIMMED_OPACITY = "0.35";

export function applyPlacementVisibility(element: HTMLElement, visible: boolean, framedByEditor: boolean): void {
  if (framedByEditor) {
    element.style.visibility = "";
    element.style.opacity = visible ? "" : DIMMED_OPACITY;
    return;
  }
  element.style.opacity = "";
  element.style.visibility = visible ? "" : "hidden";
}
