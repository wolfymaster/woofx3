// Logical OBS command intent emitted by the engine and consumed by the
// Convex-side OBS Controller. The engine never references OBS source/scene
// names; the mapping lives in Convex's PlatformActionMap.
// See woofx3/browser-source-spec.md.

export type OBSCommandType =
    | 'scene_transition'
    | 'source_visibility'
    | 'filter_state'
    | 'audio_state'
    | 'media_playback'
    | 'hotkey'
    | 'transform';

export type OBSCommandAction =
    | 'activate'
    | 'show'
    | 'hide'
    | 'toggle'
    | 'play'
    | 'stop'
    | 'set';

export interface OBSCommand {
    id: string;
    type: OBSCommandType;
    target: string;
    action: OBSCommandAction;
    params: Record<string, unknown>;
    ttl: number;
    priority: number;
}

// NATS subject for any future producer (workflow / module) to publish a
// logical OBS command intent for the API service to forward to Convex.
// Reserved; no current producer.
export enum EventType {
    ObsCommand = 'engine.obs.command',
}
