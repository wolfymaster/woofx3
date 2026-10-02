// The scene's background colour, from the `backgroundColor` the dashboard
// saves in the scene layout. Unset means transparent: OBS composites the
// overlay over whatever sits beneath the browser source.

/** The layout's background colour, or null when the scene should stay transparent. */
export function sceneBackground(layout: Record<string, unknown>): string | null {
  const value = layout.backgroundColor;
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Paints the scene background onto `element`. Assigned through the style
 * object rather than written into a stylesheet: the value is user-supplied,
 * and the CSSOM drops anything that isn't a single valid colour instead of
 * letting it inject further declarations.
 */
export function applySceneBackground(element: HTMLElement, layout: Record<string, unknown>): void {
  const background = sceneBackground(layout);
  if (background !== null) {
    element.style.backgroundColor = background;
  }
}
