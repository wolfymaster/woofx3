// Logical OBS command intent in the Convex webhook contract, for a Convex-side
// OBS Controller. It names logical targets; the mapping to OBS scene and source
// names lives in Convex's PlatformActionMap. See woofx3/browser-source-spec.md.
// Not the payload of `engine.obs.command`, which is ObsControlCommand below.

export type OBSCommandType =
  | "scene_transition"
  | "source_visibility"
  | "filter_state"
  | "audio_state"
  | "media_playback"
  | "hotkey"
  | "transform";

export type OBSCommandAction = "activate" | "show" | "hide" | "toggle" | "play" | "stop" | "set";

export interface OBSCommand {
  id: string;
  type: OBSCommandType;
  target: string;
  action: OBSCommandAction;
  params: Record<string, unknown>;
  ttl: number;
  priority: number;
}

/**
 * One request to the OBS connection the scene manager holds, carried as the
 * `data` of an `engine.obs.command` CloudEvent. Request/reply: the scene
 * manager answers every command with an `ObsControlReply`.
 *
 * Producers are the engine itself -- the workflow `obs.*` actions and the api's
 * `listObsScenes` -- never module code. Names are OBS's own scene, source and
 * input names, exactly as the streamer sees them in OBS.
 *
 * Must match `obsCommand` in workflow/obs_actions.go.
 */
export type ObsControlCommand =
  | { command: "switch_scene"; sceneName: string }
  | {
      command: "set_source_visibility";
      /** The current program scene when absent. */
      sceneName?: string;
      sourceName: string;
      visible: boolean;
    }
  | { command: "set_input_mute"; inputName: string; muted: boolean }
  | { command: "list_scenes" };

export type ObsControlCommandName = ObsControlCommand["command"];

/** A source placed in a scene, as `list_scenes` reports it. */
export interface ObsSceneSource {
  name: string;
  sceneItemId: number;
  /** OBS input kind (e.g. `browser_source`); null for a nested scene or group. */
  inputKind: string | null;
  enabled: boolean;
}

export interface ObsSceneSummary {
  name: string;
  sources: ObsSceneSource[];
}

export type ObsControlReply =
  | { ok: true; scenes?: ObsSceneSummary[] }
  | {
      ok: false;
      /** Written for the streamer: it becomes the failed step's error. */
      error: string;
    };

export enum EventType {
  ObsCommand = "engine.obs.command",
}
