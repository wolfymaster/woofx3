// What the editor knows about the widgets it can place, and the placement a
// new one starts as.
//
// The catalog is the installed widgets as the dashboard lists them: each
// row's canonical id, name, settings schema (whose `defaultValue`s seed a new
// placement), the surfaces it may be placed on, and the surface it hosts (an
// alert area hosts alerts). How a new layer starts out (its size, its length
// on an alert, Text's starting text) is the editor's choice for the bundled
// widgets, keyed by their canonical ids here. How a widget's box is edited
// once placed (Text's height follows its text) is a
// constraint of the widget, and lives with its traits in the type registry.
//
// Alert-host naming must agree with the scene manager's matching (woofx3
// sceneManager/src/scene/alert-layout.ts) and with the dashboard
// (woofx3-ui convex/lib/alertWidgets.ts).

import { assert } from "../model/composition";
import { HOST_EFFECT_KINDS, HOST_TRANSITION_KINDS } from "../model/entity-types";
import { evenKeys, keyBetween, stackOrder } from "../model/keys";
import type { KindExecutor } from "../model/registry";
import type { CompositionDocument, CompositionProfile, PlacementDocument } from "../model/types";
import { type CanvasSize, MEDIA_ASPECT, type Point, textBoxHeight, withCenter } from "./geometry";

/** A settings field as the catalog declares it; only what seeding a placement reads. */
export interface CatalogSettingField {
  id: string;
  defaultValue?: unknown;
  [key: string]: unknown;
}

export interface CatalogWidget {
  /** Canonical id, `{moduleId}:widget:{manifestId}`. */
  widgetId: string;
  name: string;
  settings: readonly CatalogSettingField[];
  /** Where the widget may be placed. Absent means a scene widget, as rows registered before surfaces existed are. */
  surfaces?: readonly string[];
  /** The surface the widget hosts on the page, when it hosts one: `alert` for an alert area. */
  hostsSurface?: string;
  /**
   * The transition and effect kinds the widget plays itself, as the engine's
   * `getAvailableWidgets` lists them. Absent means it declares none.
   */
  behaviorKinds?: {
    transitions: readonly CatalogBehaviorKind[];
    effects: readonly CatalogBehaviorKind[];
  };
}

export interface CatalogBehaviorKind {
  id: string;
  label: string;
}

/** A kind a behavior on a widget may take, and who plays it. */
export interface OfferedKind {
  kind: string;
  executor: KindExecutor;
  /** The widget's label for a kind it declares; a host kind's label is the UI's to choose. */
  label?: string;
}

/**
 * The kinds a `type` behavior on a placement of `row` may take: the host's,
 * which every widget gets, then the ones the widget declares. Any other kind
 * would be skipped by the overlay, so an editor offers only these. With no
 * row (the canvas, or a widget no longer installed), only the host's.
 */
export function offeredKinds(row: CatalogWidget | undefined, type: "transition" | "effect"): OfferedKind[] {
  const host = type === "transition" ? HOST_TRANSITION_KINDS : HOST_EFFECT_KINDS;
  const declared = row?.behaviorKinds?.[type === "transition" ? "transitions" : "effects"] ?? [];
  return [
    ...host.map((kind): OfferedKind => ({ kind, executor: "host" })),
    ...declared.map(({ id, label }): OfferedKind => ({ kind: id, executor: "widget", label })),
  ];
}

/** A placement's widget kind, for the starting defaults below and for the UI to pick an inspector. */
export type WidgetKind = "text" | "image" | "video" | "audio" | "lottie" | "other";

const KIND_BY_WIDGET_ID: Readonly<Record<string, WidgetKind>> = {
  "woofx3:widget:text": "text",
  "woofx3:widget:image": "image",
  "woofx3:widget:video": "video",
  "woofx3:widget:audio": "audio",
  "woofx3:widget:lottie": "lottie",
};

export function widgetKind(widgetId: string): WidgetKind {
  return KIND_BY_WIDGET_ID[widgetId] ?? "other";
}

/**
 * Seconds a new alert layer plays. Zero is a real setting (the widget
 * completes at once, or media plays through), but a layer that ends the
 * moment it starts makes an alert that flashes, so new layers start with a
 * length of their own.
 */
export const DEFAULT_DURATION_SECONDS: Readonly<Record<WidgetKind, number>> = {
  text: 5,
  image: 5,
  video: 8,
  audio: 3,
  lottie: 4,
  other: 5,
};

/** Audio has nothing to draw, so a new audio layer sits out of the way in the top right as a small marker. */
const AUDIO_CENTER: Point = { x: 1780, y: 60 };
const AUDIO_SIZE = { width: 200, height: 80 };
/** A scene widget's starting size, before the user sizes it. */
const SCENE_WIDGET_SIZE = { width: 300, height: 200 };
/** How far each new placement steps off the last, so adding the same widget twice doesn't stack it exactly. */
const ADD_OFFSET = 40;

/** A placement id: it ends up in frame URLs, so the scene manager holds it to a URL-safe token. */
export const NODE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** The catalog rows that may be placed on a profile's surface. */
export function placeableOn(catalog: readonly CatalogWidget[], profile: CompositionProfile): CatalogWidget[] {
  return catalog.filter((row) => (row.surfaces ?? ["scene"]).includes(profile.surface));
}

/** What a scene's first alert area is called, and what a step with no target plays on. */
export const DEFAULT_ALERT_WIDGET_NAME = "default";

/** The name an alert area answers to: its `name` setting, or the default when blank. */
export function alertWidgetName(settings: Record<string, unknown> | undefined): string {
  const name = typeof settings?.name === "string" ? settings.name.trim() : "";
  return name || DEFAULT_ALERT_WIDGET_NAME;
}

/** The default for the first alert area, then the first free `alert-N`, so two never share a name by accident. */
export function nextAlertWidgetName(existing: readonly string[]): string {
  const taken = new Set(existing);
  if (!taken.has(DEFAULT_ALERT_WIDGET_NAME)) {
    return DEFAULT_ALERT_WIDGET_NAME;
  }
  for (let n = 2; ; n++) {
    const candidate = `alert-${n}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

/** `w-N` for the first N not taken. */
export function sequentialNodeId(taken: ReadonlySet<string>): string {
  let index = taken.size + 1;
  while (taken.has(`w-${index}`)) {
    index += 1;
  }
  return `w-${index}`;
}

/**
 * A random `w-` id. The default for new placements: two editors adding at
 * once must not pick the same id, or json0 keeps one insert and drops the
 * other.
 */
export function randomNodeId(taken: ReadonlySet<string>): string {
  for (;;) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const id = `w-${Array.from(bytes, (byte) => (byte % 36).toString(36)).join("")}`;
    if (!taken.has(id)) {
      return id;
    }
  }
}

/**
 * The canvas size a composition's layout declares, or null when it declares
 * none that can be drawn. The registry never lets an edit leave a canvas
 * like that, but a stored document can still arrive with one.
 */
export function canvasSizeOf(doc: CompositionDocument): CanvasSize | null {
  const { width, height } = doc.layout;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { width, height };
}

/** The canvas size a composition's layout declares. Fails fast on a layout without one. */
export function canvasOf(doc: CompositionDocument): CanvasSize {
  const size = canvasSizeOf(doc);
  assert(size !== null, "a composition's layout has a positive width and height");
  return size;
}

/** The key that puts a new placement on top of `doc`'s stack. */
export function topKey(doc: CompositionDocument): string {
  const order = stackOrder(doc);
  const top = order.length === 0 ? null : (doc.widgets[order[order.length - 1] as string] as PlacementDocument).z;
  try {
    return keyBetween(top, null);
  } catch {
    // The top key is not one keys.ts can build on (a document written by
    // hand): start above it as text instead, which still sorts last.
    return `${top}${evenKeys(1)[0]}`;
  }
}

export interface NewPlacementInput {
  row: CatalogWidget;
  /** The whole catalog: which placements already on the canvas are alert areas. */
  catalog: readonly CatalogWidget[];
  doc: CompositionDocument;
  profile: CompositionProfile;
  /** Where to put the new placement's centre; absent centres it, stepped off the placements already there. */
  at?: Point;
}

/**
 * A new placement for a catalog widget: its declared defaults, sized and
 * placed for its kind, on top of the stack. On an alert, each layer gets a
 * length of its own and Text starts with visible text. An alert area gets
 * the next free alert name.
 */
export function newPlacement({ row, catalog, doc, profile, at }: NewPlacementInput): PlacementDocument {
  const canvas = canvasOf(doc);
  const kind = widgetKind(row.widgetId);
  const settings: Record<string, unknown> = {};
  for (const field of row.settings) {
    if (field.defaultValue !== undefined) {
      settings[field.id] = structuredClone(field.defaultValue);
    }
  }
  let size: { width: number; height: number } = SCENE_WIDGET_SIZE;
  if (profile.id === "alert") {
    settings.duration = DEFAULT_DURATION_SECONDS[kind];
    if (kind === "text") {
      settings.text = "New text";
      settings.fontSize = 48;
      settings.color = "#ffffff";
    }
    size =
      kind === "audio"
        ? AUDIO_SIZE
        : kind === "text"
          ? { width: 1200, height: textBoxHeight(48, "New text") }
          : { width: 640, height: Math.round(640 * MEDIA_ASPECT) };
  }
  if (row.hostsSurface === "alert") {
    const hosts = new Set(catalog.filter((entry) => entry.hostsSurface === "alert").map((entry) => entry.widgetId));
    const names = Object.values(doc.widgets)
      .filter((placement) => hosts.has(placement.widget))
      .map((placement) => alertWidgetName(placement.settings));
    settings.name = nextAlertWidgetName(names);
  }
  const offset = ADD_OFFSET * (Object.keys(doc.widgets).length % 4);
  const center =
    at ??
    (profile.id === "alert" && kind === "audio"
      ? AUDIO_CENTER
      : { x: canvas.width / 2 + offset, y: canvas.height / 2 + offset });
  const box = withCenter({ x: 0, y: 0, ...size }, center);
  return {
    widget: row.widgetId,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    visible: true,
    z: topKey(doc),
    settings,
    name: row.name,
    rotation: 0,
    opacity: 1,
    locked: false,
    extra: {},
  };
}
