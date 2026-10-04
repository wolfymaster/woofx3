/**
 * Which placements a workflow has shown or hidden on each scene.
 *
 * A placement's saved `hidden` is where it starts; a workflow step overrides
 * that until this service restarts. Held in memory on purpose: a show or hide
 * is a moment in a stream, not an edit, so writing it into the scene would
 * turn every toggle into a save that races the editor's own. After a restart
 * every placement is back at its saved default, which is why that default is
 * saved at all: a widget meant to stay hidden until something happens stays
 * hidden.
 *
 * Each override remembers the saved default it was made against. When the
 * streamer changes that default in the editor, their edit is the newer
 * intent, so the override is dropped rather than silently winning over it.
 */
export class PlacementVisibility {
  private readonly overrides = new Map<string, Map<string, { visible: boolean; savedHidden: boolean }>>();

  set(sceneId: string, placement: { id: string; hidden: boolean }, visible: boolean): void {
    let scene = this.overrides.get(sceneId);
    if (!scene) {
      scene = new Map();
      this.overrides.set(sceneId, scene);
    }
    scene.set(placement.id, { visible, savedHidden: placement.hidden });
  }

  /** Whether the placement is on screen now: its override, or else its saved default. */
  visibleOf(sceneId: string, placement: { id: string; hidden: boolean }): boolean {
    const scene = this.overrides.get(sceneId);
    const override = scene?.get(placement.id);
    if (!scene || !override) {
      return !placement.hidden;
    }
    if (override.savedHidden !== placement.hidden) {
      scene.delete(placement.id);
      return !placement.hidden;
    }
    return override.visible;
  }
}
