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
 * One change to OBS, carried as the `data` of an `engine.obs.command`
 * CloudEvent to the OBS connection the scene manager holds. Request/reply: the
 * scene manager answers every command with an `ObsControlReply`.
 *
 * The only producer is barkloader's `ctx.obs` extension, on behalf of module
 * code holding the `obs.control` permission; a module never chooses the
 * subject. Names are OBS's own scene, source and input names, exactly as the
 * streamer sees them in OBS.
 *
 * Must match the commands built in barkloader/lib_sandbox/src/extensions/obs.rs.
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
  | { command: "set_input_mute"; inputName: string; muted: boolean };

export type ObsControlCommandName = ObsControlCommand["command"];

export type ObsControlReply =
  | { ok: true }
  | {
      ok: false;
      /** Written for the streamer: it becomes the failed step's error. */
      error: string;
    };

/**
 * What to list, carried as the `data` of an `engine.obs.options` CloudEvent.
 * Sent by barkloader's `ctx.obs.listScenes`, `listSources` and `listInputs`.
 * A subject apart from `engine.obs.command`, so that reading OBS's names
 * never needs the permission that changing OBS does.
 */
/**
 * Request/reply subject the api asks the scene manager's OBS connection state
 * on. The reply is the api's `ObsStatus` without `unanswered`, which only the
 * api can observe.
 */
export const OBS_STATUS_SUBJECT = "engine.obs.status";

export type ObsOptionsRequest = { list: ObsOptionsList };

export const OBS_OPTIONS_LISTS = ["scenes", "sources", "inputs"] as const;

export type ObsOptionsList = (typeof OBS_OPTIONS_LISTS)[number];

/**
 * One option in the shape the UI's field-options select reads: `value` is the
 * name saved into the field, `label` what the picker shows, and `group` the
 * heading the option is listed under.
 */
export interface ObsFieldOption {
  value: string;
  label: string;
  group?: string;
}

/** The options, or why OBS could not be asked; `{ error }` is the field-options failure reply. */
export type ObsOptionsReply = ObsFieldOption[] | { error: string };

export enum EventType {
  ObsCommand = "engine.obs.command",
  ObsOptions = "engine.obs.options",
}
