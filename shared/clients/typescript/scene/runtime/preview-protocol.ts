// The messages between the editor and sceneManager's composition preview page.
//
// The dashboard's alert editor embeds `/preview/composition` in an iframe and
// drives it entirely by postMessage: it loads a composition with a sample
// event, lays gesture state over it, and plays, pauses, seeks and restarts
// it. The page plays the composition with this package's runtime and real
// widget frames, and reports back what the editor draws its timeline from.
//
// Both sides import these types, and each parses what it receives with the
// parser here: anything can be posted to a window, so a parser never throws
// and never lets a malformed value through. A message whose `type` is not one
// of this protocol's is not for it (`null`); one that is but does not parse
// is refused with a reason.
//
// Entries of a loaded document are checked one by one with the tolerant
// registry, as an overlay treats a merged document: an entry that cannot be
// played is dropped and reported, and the rest still plays. An entry of a
// type this build does not know is kept, and the runtime skips it.

import { isPlainObject, normalizeComposition } from "../model/composition";
import { isOrderKey } from "../model/keys";
import { alertCompositionOf } from "../model/legacy-alert";
import { type CollectionName, TOLERANT_REGISTRY } from "../model/registry";
import type { ResolvedTimeline } from "../model/timeline";
import type { CompositionDocument, NodeId, PlacementDocument, ProfileId } from "../model/types";
import type { TransientOverrides } from "./plan";

/** Bumped when a change to these messages would be misread by the other side. */
export const COMPOSITION_PREVIEW_PROTOCOL = 1;

/** What every message type of this protocol starts with. */
const PREFIX = "woofx3.composition-preview.";

/** Parent to page. */
export const PREVIEW_LOAD = "woofx3.composition-preview.load";
export const PREVIEW_OVERRIDES = "woofx3.composition-preview.overrides";
export const PREVIEW_PLAY = "woofx3.composition-preview.play";
export const PREVIEW_PAUSE = "woofx3.composition-preview.pause";
export const PREVIEW_SEEK = "woofx3.composition-preview.seek";
export const PREVIEW_RESTART = "woofx3.composition-preview.restart";

/** Page to parent. */
export const PREVIEW_READY = "woofx3.composition-preview.ready";
export const PREVIEW_TIMELINE = "woofx3.composition-preview.timeline";
export const PREVIEW_PLAYHEAD = "woofx3.composition-preview.playhead";
export const PREVIEW_FINISHED = "woofx3.composition-preview.finished";
export const PREVIEW_PROBLEMS = "woofx3.composition-preview.problems";

/** Longest `loadId` accepted; the parent picks it, the page only echoes it. */
export const PREVIEW_LOAD_ID_MAX_LENGTH = 128;

/** The event a preview hands its widgets, as a step's alert would carry it. */
export interface PreviewSampleEvent {
  type: string;
  data: unknown;
}

/**
 * Play `document` from its start, replacing whatever the page was playing.
 * Widgets are framed afresh, so this is for a changed document; a gesture in
 * progress goes in `overrides` instead.
 */
export interface PreviewLoadMessage {
  type: typeof PREVIEW_LOAD;
  /** Chosen by the parent and echoed on every report about this load, so a report about an older one can be told apart. */
  loadId: string;
  profile: ProfileId;
  document: CompositionDocument;
  /** What the widgets receive as the alert's event; none when absent. */
  event?: PreviewSampleEvent | null;
  /** Values for the composition's inputs, bound before it plays (a missing one takes its default). */
  inputs?: Record<string, unknown>;
  /** Start playing once loaded; otherwise the page holds at 0 ms until `play`. */
  autoplay?: boolean;
}

/** Lay uncommitted gesture state over the loaded document; `null` clears it. */
export interface PreviewOverridesMessage {
  type: typeof PREVIEW_OVERRIDES;
  overrides: TransientOverrides | null;
}

export interface PreviewPlayMessage {
  type: typeof PREVIEW_PLAY;
}

export interface PreviewPauseMessage {
  type: typeof PREVIEW_PAUSE;
}

/** Move the playhead to `ms` since the composition started, playing or paused as before. */
export interface PreviewSeekMessage {
  type: typeof PREVIEW_SEEK;
  ms: number;
}

/** Play the loaded document again from the start with fresh frames, as an overlay would. */
export interface PreviewRestartMessage {
  type: typeof PREVIEW_RESTART;
}

export type PreviewCommand =
  | PreviewLoadMessage
  | PreviewOverridesMessage
  | PreviewPlayMessage
  | PreviewPauseMessage
  | PreviewSeekMessage
  | PreviewRestartMessage;

/** An entry of a loaded document that cannot be played, left out. */
export interface DroppedEntry {
  collection: CollectionName;
  id: string;
  reason: string;
}

export type PreviewCommandParse =
  | { ok: true; command: PreviewCommand; dropped: DroppedEntry[] }
  | { ok: false; error: string };

/** The page is listening. Sent once, before any load. */
export interface PreviewReadyReport {
  type: typeof PREVIEW_READY;
  protocol: typeof COMPOSITION_PREVIEW_PROTOCOL;
}

/**
 * The loaded composition's timeline, resolved from estimates and what its
 * frames have reported (see the page's measuring rule). Sent after a load and
 * whenever it changes.
 */
export interface PreviewTimelineReport {
  type: typeof PREVIEW_TIMELINE;
  loadId: string;
  timeline: ResolvedTimeline;
  /** When an alert has finished, exits included; `null` for a scene, which runs until changed. */
  durationMs: number | null;
}

/** Where the playhead is. Sent on every change of state and regularly while playing. */
export interface PreviewPlayheadReport {
  type: typeof PREVIEW_PLAYHEAD;
  loadId: string;
  ms: number;
  playing: boolean;
}

/** An alert played to its finish; the page holds there, paused. */
export interface PreviewFinishedReport {
  type: typeof PREVIEW_FINISHED;
  loadId: string;
  ms: number;
}

export type PreviewProblemKind =
  /** A message the page could not parse; `detail` says why. */
  | "invalid-message"
  /** A widget or behavior left out of the loaded document; `id`, and the reason in `detail`. */
  | "invalid-entry"
  /** The inputs could not be bound, so nothing plays; `detail` names what is missing or wrong. */
  | "bind"
  /** A widget whose canonical id matches nothing installed; `id`. */
  | "unknown-widget"
  /** A widget the page draws itself on an overlay (an alert area), which a preview does not; `id`. */
  | "unframed-widget"
  /** The engine could not say how to frame the widgets; `detail`. */
  | "frames-unavailable"
  /** A behavior the timeline could not honour; `id`, and the `TimelineProblemKind` in `detail`. */
  | "timeline"
  /** A behavior the runtime does not play; `id`, and the `PlanSkipReason` in `detail`. */
  | "plan";

export interface PreviewProblem {
  kind: PreviewProblemKind;
  id?: string;
  detail?: string;
}

/** Every problem with the current load, replacing the last report. */
export interface PreviewProblemsReport {
  type: typeof PREVIEW_PROBLEMS;
  /** `null` for a problem with no load to belong to (a message that did not parse). */
  loadId: string | null;
  problems: PreviewProblem[];
}

export type PreviewReport =
  | PreviewReadyReport
  | PreviewTimelineReport
  | PreviewPlayheadReport
  | PreviewFinishedReport
  | PreviewProblemsReport;

export type PreviewReportParse = { ok: true; report: PreviewReport } | { ok: false; error: string };

const PROBLEM_KINDS: ReadonlySet<string> = new Set<PreviewProblemKind>([
  "invalid-message",
  "invalid-entry",
  "bind",
  "unknown-widget",
  "unframed-widget",
  "frames-unavailable",
  "timeline",
  "plan",
]);

/** Whether `data` claims to be a message of this protocol, whatever its shape. */
export function isPreviewMessage(data: unknown): boolean {
  return isPlainObject(data) && typeof data.type === "string" && data.type.startsWith(PREFIX);
}

/** A message posted to the preview page: `null` when it is not one of this protocol's. */
export function parsePreviewCommand(data: unknown): PreviewCommandParse | null {
  if (!isPreviewMessage(data)) {
    return null;
  }
  const message = data as Record<string, unknown>;
  try {
    switch (message.type) {
      case PREVIEW_LOAD:
        return parseLoad(message);
      case PREVIEW_OVERRIDES:
        return parseOverridesMessage(message);
      case PREVIEW_PLAY:
        return { ok: true, command: { type: PREVIEW_PLAY }, dropped: [] };
      case PREVIEW_PAUSE:
        return { ok: true, command: { type: PREVIEW_PAUSE }, dropped: [] };
      case PREVIEW_RESTART:
        return { ok: true, command: { type: PREVIEW_RESTART }, dropped: [] };
      case PREVIEW_SEEK:
        if (!isFiniteNumber(message.ms) || message.ms < 0) {
          return refuse("seek needs a non-negative finite ms");
        }
        return { ok: true, command: { type: PREVIEW_SEEK, ms: message.ms }, dropped: [] };
      default:
        return refuse(`unknown command ${String(message.type)}`);
    }
  } catch (err) {
    // The registry's checks assert on shapes they were never meant to see;
    // a parser of posted data answers rather than throws.
    return refuse(`malformed message: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** A message posted by the preview page: `null` when it is not one of this protocol's. */
export function parsePreviewReport(data: unknown): PreviewReportParse | null {
  if (!isPreviewMessage(data)) {
    return null;
  }
  const message = data as Record<string, unknown>;
  switch (message.type) {
    case PREVIEW_READY:
      if (message.protocol !== COMPOSITION_PREVIEW_PROTOCOL) {
        return { ok: false, error: `unsupported preview protocol ${String(message.protocol)}` };
      }
      return { ok: true, report: { type: PREVIEW_READY, protocol: COMPOSITION_PREVIEW_PROTOCOL } };
    case PREVIEW_TIMELINE: {
      const durationMs = message.durationMs;
      if (!isLoadId(message.loadId) || !isTimelineShape(message.timeline)) {
        return { ok: false, error: "timeline needs a loadId and a resolved timeline" };
      }
      if (durationMs !== null && !(isFiniteNumber(durationMs) && durationMs >= 0)) {
        return { ok: false, error: "timeline durationMs must be a non-negative number or null" };
      }
      return {
        ok: true,
        report: { type: PREVIEW_TIMELINE, loadId: message.loadId, timeline: message.timeline, durationMs },
      };
    }
    case PREVIEW_PLAYHEAD:
      if (!isLoadId(message.loadId) || !isFiniteNumber(message.ms) || typeof message.playing !== "boolean") {
        return { ok: false, error: "playhead needs a loadId, ms and playing" };
      }
      return {
        ok: true,
        report: { type: PREVIEW_PLAYHEAD, loadId: message.loadId, ms: message.ms, playing: message.playing },
      };
    case PREVIEW_FINISHED:
      if (!isLoadId(message.loadId) || !isFiniteNumber(message.ms)) {
        return { ok: false, error: "finished needs a loadId and ms" };
      }
      return { ok: true, report: { type: PREVIEW_FINISHED, loadId: message.loadId, ms: message.ms } };
    case PREVIEW_PROBLEMS: {
      const loadId = message.loadId;
      if ((loadId !== null && !isLoadId(loadId)) || !Array.isArray(message.problems)) {
        return { ok: false, error: "problems needs a loadId or null, and a list" };
      }
      const problems: PreviewProblem[] = [];
      for (const raw of message.problems) {
        const problem = parseProblem(raw);
        if (problem === null) {
          return { ok: false, error: "problems holds an entry that is not a problem" };
        }
        problems.push(problem);
      }
      return { ok: true, report: { type: PREVIEW_PROBLEMS, loadId, problems } };
    }
    default:
      return { ok: false, error: `unknown report ${String(message.type)}` };
  }
}

function parseLoad(message: Record<string, unknown>): PreviewCommandParse {
  if (!isLoadId(message.loadId)) {
    return refuse(`load needs a loadId of 1 to ${PREVIEW_LOAD_ID_MAX_LENGTH} characters`);
  }
  const profile = message.profile;
  if (profile !== "alert" && profile !== "scene") {
    return refuse('load needs a profile of "alert" or "scene"');
  }
  // An alert may still arrive in the list shape a step stores inline.
  const shaped = profile === "alert" ? alertCompositionOf(message.document) : normalizeComposition(message.document);
  if (shaped === null) {
    return refuse("load needs a composition document");
  }
  const { width, height } = shaped.layout;
  if (!(isFiniteNumber(width) && width > 0 && isFiniteNumber(height) && height > 0)) {
    return refuse("the composition's canvas needs a positive width and height");
  }
  if (shaped.inputs !== undefined && !Array.isArray(shaped.inputs)) {
    return refuse("the composition's inputs must be a list");
  }
  const { document, dropped } = playableEntries(TOLERANT_REGISTRY.migrateDocument(shaped));

  let event: PreviewSampleEvent | null = null;
  if (message.event !== undefined && message.event !== null) {
    if (!isPlainObject(message.event) || typeof message.event.type !== "string") {
      return refuse("load event needs a type");
    }
    event = { type: message.event.type, data: message.event.data ?? null };
  }
  let inputs: Record<string, unknown> = {};
  if (message.inputs !== undefined) {
    if (!isPlainObject(message.inputs)) {
      return refuse("load inputs must be an object of values by input id");
    }
    inputs = message.inputs;
  }
  if (message.autoplay !== undefined && typeof message.autoplay !== "boolean") {
    return refuse("load autoplay must be a boolean");
  }
  return {
    ok: true,
    command: {
      type: PREVIEW_LOAD,
      loadId: message.loadId,
      profile,
      document,
      event,
      inputs,
      autoplay: message.autoplay === true,
    },
    dropped,
  };
}

/** The document with every entry the registry refuses left out. */
function playableEntries(doc: CompositionDocument): { document: CompositionDocument; dropped: DroppedEntry[] } {
  const dropped: DroppedEntry[] = [];
  const keep = <T>(collection: CollectionName, entries: Record<string, T>): Record<string, T> => {
    const kept: Record<string, T> = {};
    for (const [id, entry] of Object.entries(entries)) {
      const reason = TOLERANT_REGISTRY.invalidEntry(collection, entry);
      if (reason === null) {
        kept[id] = entry;
      } else {
        dropped.push({ collection, id, reason });
      }
    }
    return kept;
  };
  const widgets = keep("widgets", doc.widgets);
  const behaviors = keep("behaviors", doc.behaviors);
  return { document: { ...doc, widgets, behaviors }, dropped };
}

const OVERRIDE_NUMBERS = ["x", "y", "width", "height", "rotation"] as const;

function parseOverridesMessage(message: Record<string, unknown>): PreviewCommandParse {
  if (message.overrides === null) {
    return { ok: true, command: { type: PREVIEW_OVERRIDES, overrides: null }, dropped: [] };
  }
  if (!isPlainObject(message.overrides)) {
    return refuse("overrides must be an object by widget id, or null");
  }
  const overrides: Record<NodeId, TransientOverrides[NodeId]> = {};
  for (const [id, raw] of Object.entries(message.overrides)) {
    if (!isPlainObject(raw)) {
      return refuse(`overrides for ${id} must be an object`);
    }
    const override: Partial<Pick<PlacementDocument, "x" | "y" | "width" | "height" | "rotation" | "opacity" | "z">> =
      {};
    for (const key of OVERRIDE_NUMBERS) {
      if (raw[key] !== undefined) {
        const value = raw[key];
        if (!isFiniteNumber(value)) {
          return refuse(`overrides for ${id}: ${key} must be a finite number`);
        }
        override[key] = value;
      }
    }
    if (
      (override.width !== undefined && override.width < 0) ||
      (override.height !== undefined && override.height < 0)
    ) {
      return refuse(`overrides for ${id}: a size cannot be negative`);
    }
    if (raw.opacity !== undefined) {
      if (!isFiniteNumber(raw.opacity) || raw.opacity < 0 || raw.opacity > 1) {
        return refuse(`overrides for ${id}: opacity must be from 0 to 1`);
      }
      override.opacity = raw.opacity;
    }
    if (raw.z !== undefined) {
      if (typeof raw.z !== "string" || !isOrderKey(raw.z)) {
        return refuse(`overrides for ${id}: z must be an order key`);
      }
      override.z = raw.z;
    }
    // Keys this build does not know are left out: a newer editor may send
    // more, and the box it knows still moves.
    overrides[id] = override;
  }
  return { ok: true, command: { type: PREVIEW_OVERRIDES, overrides }, dropped: [] };
}

function parseProblem(raw: unknown): PreviewProblem | null {
  if (!isPlainObject(raw) || typeof raw.kind !== "string" || !PROBLEM_KINDS.has(raw.kind)) {
    return null;
  }
  if (
    (raw.id !== undefined && typeof raw.id !== "string") ||
    (raw.detail !== undefined && typeof raw.detail !== "string")
  ) {
    return null;
  }
  return {
    kind: raw.kind as PreviewProblemKind,
    ...(raw.id === undefined ? {} : { id: raw.id as string }),
    ...(raw.detail === undefined ? {} : { detail: raw.detail as string }),
  };
}

/** The outer shape of a resolved timeline; its entries are the page's own output. */
function isTimelineShape(value: unknown): value is ResolvedTimeline {
  return (
    isPlainObject(value) &&
    isPlainObject(value.widgets) &&
    isPlainObject(value.behaviors) &&
    isPlainObject(value.canvas) &&
    Array.isArray(value.problems)
  );
}

function isLoadId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= PREVIEW_LOAD_ID_MAX_LENGTH;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function refuse(error: string): PreviewCommandParse {
  return { ok: false, error };
}
