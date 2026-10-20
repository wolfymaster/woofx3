// What the preview server and its page say to each other: the routes the
// page uses, and the module it is told about.

import type { ConfigField } from "@woofx3/api/ui-schema";
import type { WidgetSurface } from "@woofx3/module-sdk";

/** The page's script bundle. */
export const PAGE_SCRIPT_PATH = "/preview.js";
/** The module and its widgets, as `ModuleAnswer`. */
export const MODULE_PATH = "/api/module";
/** A server-sent event stream with one `change` event whenever a file in the module changes. */
export const CHANGES_PATH = "/api/changes";
export const CHANGE_EVENT = "change";
/** `/frames/{widgetId}`: a widget's frame document, the placement in its fragment. */
export const FRAME_PATH_PREFIX = "/frames/";
/** Where the shim links a font setting's stylesheet (`?family=`); its files are under `FONT_FILES_PREFIX`. */
export const FONT_STYLESHEET_PATH = "/fonts/css";
export const FONT_FILES_PREFIX = "/fonts/files/";

export function framePath(widgetId: string): string {
  return `${FRAME_PATH_PREFIX}${encodeURIComponent(widgetId)}`;
}

/** One widget the page can host. */
export interface WidgetView {
  id: string;
  name: string;
  canonicalId: string;
  surfaces: WidgetSurface[];
  settingsSchema: ConfigField[];
}

export interface ModuleView {
  id: string;
  name: string;
  widgets: WidgetView[];
}

/** `GET /api/module`: the module, or why its manifest could not be read. */
export type ModuleAnswer = { module: ModuleView } | { error: { code: "manifest_invalid"; message: string } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWidgetView(value: unknown): value is WidgetView {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.canonicalId === "string" &&
    Array.isArray(value.surfaces) &&
    value.surfaces.every((surface) => surface === "scene" || surface === "alert") &&
    Array.isArray(value.settingsSchema)
  );
}

/** The server's answer to `GET /api/module`, or null for anything else. */
export function parseModuleAnswer(value: unknown): ModuleAnswer | null {
  if (!isRecord(value)) {
    return null;
  }
  if (isRecord(value.error) && typeof value.error.message === "string") {
    return { error: { code: "manifest_invalid", message: value.error.message } };
  }
  const module = value.module;
  if (
    !isRecord(module) ||
    typeof module.id !== "string" ||
    typeof module.name !== "string" ||
    !Array.isArray(module.widgets) ||
    !module.widgets.every(isWidgetView)
  ) {
    return null;
  }
  return { module: { id: module.id, name: module.name, widgets: module.widgets } };
}
