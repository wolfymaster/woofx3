// The module the preview hosts, read from its folder's `manifest.json`: each
// widget's files, settings form, surfaces, theme contract and font settings.
//
// Only what hosting a widget needs is read. Everything else in the manifest,
// and the finer checks on these parts, is left to install, which is still
// what decides whether the module is valid; a widget the preview runs can
// still fail to install.

import { resolve, sep } from "node:path";
import { type ConfigField, isWidgetSurface, parseFieldList } from "@woofx3/api/ui-schema";
import type { WidgetSurface } from "@woofx3/module-sdk";
import type { FrameTheme } from "../frame";

/** The manifest's file name in a module's folder. */
export const MANIFEST_FILE = "manifest.json";

/** Stands in for the installed version's storage directory in every engine path the preview serves. */
export const PREVIEW_VERSION_DIR = "preview";

/** Module and widget ids, as install accepts them. */
const ID = /^[A-Za-z0-9._-]+$/;

export interface ThemeVariable {
  id: string;
  type: "color" | "text" | "number";
  default: unknown;
}

export interface ThemeAssetSlot {
  id: string;
  /** A file inside the widget's `assets` directory, relative to the module folder. */
  default: string | null;
}

export interface ThemeContract {
  contractVersion: number;
  variables: ThemeVariable[];
  assetSlots: ThemeAssetSlot[];
}

export interface PreviewWidget {
  id: string;
  name: string;
  /** `{moduleId}:widget:{id}`. */
  canonicalId: string;
  /** The widget's `assets` directory, relative to the module folder, without a trailing `/`. */
  assetsDir: string;
  /** The entry document, relative to `assetsDir`. */
  entry: string;
  settingsSchema: ConfigField[];
  surfaces: WidgetSurface[];
  theme: ThemeContract | null;
  /** Ids of the `font` settings, in declaration order. */
  fontSettings: string[];
}

export interface PreviewModule {
  id: string;
  name: string;
  /** The widgets the preview can host: every one with an `entry`. */
  widgets: PreviewWidget[];
}

export type ModuleRead = { ok: true; module: PreviewModule } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A path in the module, as barkloader normalizes it: trimmed, `./` and
 * leading `/` dropped, `\` read as `/`. Null for one that steps out with `..`.
 */
export function normalizeModulePath(path: string): string | null {
  const normalized = path
    .trim()
    .replace(/^(\.\/)+/, "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  return normalized.split("/").includes("..") ? null : normalized;
}

/** `path` relative to the widget's `assets` directory, or null when it is not inside it. */
export function widgetRelativePath(assetsDir: string, path: string): string | null {
  const normalized = normalizeModulePath(path);
  if (normalized === null || !normalized.startsWith(`${assetsDir}/`)) {
    return null;
  }
  const rel = normalized.slice(assetsDir.length + 1);
  return rel === "" ? null : rel;
}

/** Read and check the manifest in `moduleDir`. */
export async function readPreviewModule(moduleDir: string): Promise<ModuleRead> {
  const file = Bun.file(resolve(moduleDir, MANIFEST_FILE));
  if (!(await file.exists())) {
    return { ok: false, error: `no ${MANIFEST_FILE} in ${moduleDir}` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch (err) {
    return { ok: false, error: `${MANIFEST_FILE} is not valid JSON: ${err instanceof Error ? err.message : err}` };
  }
  return parsePreviewModule(raw);
}

export function parsePreviewModule(raw: unknown): ModuleRead {
  if (!isRecord(raw)) {
    return { ok: false, error: "the manifest must be a JSON object" };
  }
  if (typeof raw.id !== "string" || !ID.test(raw.id)) {
    return { ok: false, error: "the manifest's `id` must be letters, digits, `.`, `_` or `-`" };
  }
  const moduleId = raw.id;
  const widgets: PreviewWidget[] = [];
  const declared = raw.widgets === undefined ? [] : raw.widgets;
  if (!Array.isArray(declared)) {
    return { ok: false, error: "`widgets` must be an array" };
  }
  for (const [index, entry] of declared.entries()) {
    const widget = parseWidget(moduleId, entry, index);
    if (!widget.ok) {
      return widget;
    }
    if (widget.widget !== null) {
      widgets.push(widget.widget);
    }
  }
  const name = typeof raw.name === "string" && raw.name.trim() !== "" ? raw.name : moduleId;
  return { ok: true, module: { id: moduleId, name, widgets } };
}

type WidgetRead = { ok: true; widget: PreviewWidget | null } | { ok: false; error: string };

function parseWidget(moduleId: string, raw: unknown, index: number): WidgetRead {
  if (!isRecord(raw) || typeof raw.id !== "string" || !ID.test(raw.id)) {
    return { ok: false, error: `widgets[${index}] needs an \`id\` of letters, digits, \`.\`, \`_\` or \`-\`` };
  }
  const id = raw.id;
  // A widget without an entry is drawn by the scene manager itself (the
  // bundled alert area); there is nothing of it to preview.
  if (raw.entry === undefined) {
    return { ok: true, widget: null };
  }
  if (typeof raw.entry !== "string" || typeof raw.assets !== "string") {
    return { ok: false, error: `widget ${id}: \`entry\` needs an \`assets\` directory that contains it` };
  }
  const assetsDir = normalizeModulePath(raw.assets)?.replace(/\/+$/, "") ?? null;
  if (assetsDir === null || assetsDir === "") {
    return { ok: false, error: `widget ${id}: \`assets\` must be a directory inside the module` };
  }
  const entry = widgetRelativePath(assetsDir, raw.entry);
  if (entry === null) {
    return { ok: false, error: `widget ${id}: \`entry\` ${JSON.stringify(raw.entry)} must be inside ${assetsDir}/` };
  }
  const theme = parseThemeContract(raw.theme);
  if (!theme.ok) {
    return { ok: false, error: `widget ${id}: ${theme.error}` };
  }
  const settingsSchema = Array.isArray(raw.settingsSchema) ? parseFieldList(JSON.stringify(raw.settingsSchema)) : [];
  const surfaces = Array.isArray(raw.surfaces) ? raw.surfaces.filter(isWidgetSurface) : [];
  return {
    ok: true,
    widget: {
      id,
      name: typeof raw.name === "string" && raw.name.trim() !== "" ? raw.name : id,
      canonicalId: `${moduleId}:widget:${id}`,
      assetsDir,
      entry,
      settingsSchema,
      surfaces: surfaces.length > 0 ? surfaces : ["scene"],
      theme: theme.contract,
      fontSettings: settingsSchema.filter((field) => field.type === "font").map((field) => field.id),
    },
  };
}

type ContractRead = { ok: true; contract: ThemeContract | null } | { ok: false; error: string };

function parseThemeContract(raw: unknown): ContractRead {
  if (raw === undefined) {
    return { ok: true, contract: null };
  }
  if (!isRecord(raw) || !Number.isInteger(raw.contractVersion) || (raw.contractVersion as number) < 1) {
    return { ok: false, error: "`theme.contractVersion` must be an integer from 1" };
  }
  const variables: ThemeVariable[] = [];
  for (const variable of Array.isArray(raw.variables) ? raw.variables : []) {
    if (
      !isRecord(variable) ||
      typeof variable.id !== "string" ||
      (variable.type !== "color" && variable.type !== "text" && variable.type !== "number")
    ) {
      return { ok: false, error: "every `theme.variables` entry needs an `id` and a `type` of color, text or number" };
    }
    variables.push({ id: variable.id, type: variable.type, default: variable.default });
  }
  const assetSlots: ThemeAssetSlot[] = [];
  for (const slot of Array.isArray(raw.assetSlots) ? raw.assetSlots : []) {
    if (!isRecord(slot) || typeof slot.id !== "string") {
      return { ok: false, error: "every `theme.assetSlots` entry needs an `id`" };
    }
    assetSlots.push({ id: slot.id, default: typeof slot.default === "string" ? slot.default : null });
  }
  return { ok: true, contract: { contractVersion: raw.contractVersion as number, variables, assetSlots } };
}

/**
 * A contract default as the CSS value barkloader writes for it: a finite
 * number as written, a color or text trimmed. Null for one it would leave
 * out. Whatever else install checks a value for, the frame's theme block
 * checks again before writing it (see `buildThemeStyle`).
 */
function cssDefault(variable: ThemeVariable): string | null {
  if (variable.type === "number") {
    return typeof variable.default === "number" && Number.isFinite(variable.default) ? String(variable.default) : null;
  }
  if (typeof variable.default !== "string" || variable.default.trim() === "") {
    return null;
  }
  return variable.default.trim();
}

/**
 * The theme a frame renders with when none is selected, as barkloader
 * resolves it: every variable at its default, and every asset slot showing
 * its default file under `resourceBaseUrl`. Null for a widget without a contract.
 */
export function contractDefaultTheme(widget: PreviewWidget, resourceBaseUrl: string): FrameTheme | null {
  if (widget.theme === null) {
    return null;
  }
  const variables: Record<string, string> = {};
  for (const variable of widget.theme.variables) {
    const css = cssDefault(variable);
    if (css !== null) {
      variables[variable.id] = css;
    }
  }
  const defaultAssets: Record<string, string | null> = {};
  for (const slot of widget.theme.assetSlots) {
    const rel = slot.default === null ? null : widgetRelativePath(widget.assetsDir, slot.default);
    defaultAssets[slot.id] = rel === null ? null : `${resourceBaseUrl}${rel}`;
  }
  return {
    id: null,
    contractVersion: widget.theme.contractVersion,
    variables,
    assets: { ...defaultAssets },
    defaultAssets,
    fallback: null,
    stylesheetUrl: null,
  };
}

/**
 * The file `rel` names in the widget's `assets` directory, or null when it
 * would leave it: `rel` is a decoded path below the widget's resource root.
 */
export function widgetFilePath(moduleDir: string, widget: PreviewWidget, rel: string): string | null {
  const root = resolve(moduleDir, widget.assetsDir);
  const path = resolve(root, rel);
  return path.startsWith(`${root}${sep}`) ? path : null;
}
