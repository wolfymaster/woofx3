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

/** Show a source, hide it, or flip whichever it is when the command runs. */
export type SourceVisibility = "visible" | "hidden" | "toggle";

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
      visibility: SourceVisibility;
    }
  | { command: "set_input_mute"; inputName: string; muted: boolean }
  | {
      /**
       * Point the browser source `sourceName` at `url` and show it, creating
       * it in the scene when OBS has no input by that name.
       */
      command: "show_browser_source";
      /** The current program scene when absent. */
      sceneName?: string;
      sourceName: string;
      /** An absolute http:// or https:// URL. */
      url: string;
      /** The size of a source this command creates; an existing one keeps its own. */
      width: number;
      height: number;
    };

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

/**
 * Request/reply subject asking for the OBS browser sources that show this
 * engine's overlays to be refreshed. sceneManager sends it once per start,
 * after its HTTP server listens, and again until a reply accepts it; whoever
 * holds the OBS connection answers.
 */
export const OBS_BROWSER_SOURCE_REFRESH_SUBJECT = "engine.obs.browser_source.refresh";

/** Longest `bootId` accepted: a UUID is 36 characters. */
export const OBS_REFRESH_BOOT_ID_MAX_LENGTH = 64;

/**
 * The refresh request. `overlayPort` is the port the overlays are served on,
 * which identifies the browser sources to refresh; `bootId` names the
 * sceneManager start the request is for. Answering is idempotent per `bootId`:
 * a repeat for one already latched or consumed is accepted and changes nothing.
 */
export interface ObsBrowserSourceRefresh {
  overlayPort: number;
  bootId: string;
}

export type ObsBrowserSourceRefreshReply =
  | { status: "accepted"; bootId: string }
  | { status: "invalid"; error: string };

export type ObsRefreshParse<T> = { ok: true; value: T } | { ok: false; error: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseBootId(value: unknown): ObsRefreshParse<string> {
  if (typeof value !== "string" || value.length < 1 || value.length > OBS_REFRESH_BOOT_ID_MAX_LENGTH) {
    return { ok: false, error: `bootId must be a string of 1 to ${OBS_REFRESH_BOOT_ID_MAX_LENGTH} characters` };
  }
  return { ok: true, value };
}

export function parseObsBrowserSourceRefresh(value: unknown): ObsRefreshParse<ObsBrowserSourceRefresh> {
  const body = asRecord(value);
  if (!body) {
    return { ok: false, error: "the request must be an object" };
  }
  const port = body.overlayPort;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: "overlayPort must be a whole number from 1 to 65535" };
  }
  const bootId = parseBootId(body.bootId);
  if (!bootId.ok) {
    return bootId;
  }
  return { ok: true, value: { overlayPort: port, bootId: bootId.value } };
}

export function parseObsBrowserSourceRefreshReply(value: unknown): ObsRefreshParse<ObsBrowserSourceRefreshReply> {
  const body = asRecord(value);
  if (!body) {
    return { ok: false, error: "the reply must be an object" };
  }
  if (body.status === "accepted") {
    const bootId = parseBootId(body.bootId);
    return bootId.ok ? { ok: true, value: { status: "accepted", bootId: bootId.value } } : bootId;
  }
  if (body.status === "invalid") {
    if (typeof body.error !== "string") {
      return { ok: false, error: "an invalid reply must carry an error string" };
    }
    return { ok: true, value: { status: "invalid", error: body.error } };
  }
  return { ok: false, error: 'status must be "accepted" or "invalid"' };
}

export enum EventType {
  ObsCommand = "engine.obs.command",
  ObsOptions = "engine.obs.options",
}
