/**
 * Request/reply subject the scene manager answers changes to a live scene on.
 * Under `engine.`, which only the engine may publish: a module never chooses
 * to change a scene, a workflow step the engine runs does.
 *
 * Must match sceneCommandSubject in workflow/widget_visibility.go.
 */
export const SCENE_COMMAND_SUBJECT = "engine.scene.command";

/**
 * One change to a live scene, carried as the `data` of an
 * `engine.scene.command` CloudEvent. The only producer is the workflow
 * engine's `scene.widget.visibility` action.
 *
 * `placementId` is the placement's id in the scene's widgets, not a widget
 * definition: one widget can be placed on a scene more than once.
 */
export type SceneControlCommand = {
  command: "set_placement_visibility";
  sceneId: string;
  placementId: string;
  visible: boolean;
};

export type SceneControlReply =
  | { ok: true }
  | {
      ok: false;
      /** Written for the streamer: it becomes the failed step's error. */
      error: string;
    };
