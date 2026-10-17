// What `widgetHost.assets.load` hands back, and how a reference to an asset
// is turned into the engine path the host reads it from. Shared by the shim,
// the preview mock and the scene manager, so every host resolves the same
// references to the same paths and fails them the same way.

import type { WidgetAsset } from "./widget-host";

/**
 * Why `widgetHost.assets.load` rejected.
 *
 * - `not_engine_asset`: the reference is not a file the engine stores (an
 *   external URL, an API endpoint). Load such a file yourself, if your
 *   frame's policy lets you.
 * - `out_of_scope`: an engine file outside what the widget may read: another
 *   module's files.
 * - `not_found`: no such file.
 * - `unavailable`: the engine could not be reached, or failed reading it.
 * - `disposed`: the widget was torn down before the file arrived.
 */
export type WidgetAssetErrorCode = "not_engine_asset" | "out_of_scope" | "not_found" | "unavailable" | "disposed";

const WIDGET_ASSET_ERROR_CODES: readonly WidgetAssetErrorCode[] = [
  "not_engine_asset",
  "out_of_scope",
  "not_found",
  "unavailable",
  "disposed",
];

export function isWidgetAssetErrorCode(value: unknown): value is WidgetAssetErrorCode {
  return typeof value === "string" && (WIDGET_ASSET_ERROR_CODES as readonly string[]).includes(value);
}

export class WidgetAssetError extends Error {
  readonly code: WidgetAssetErrorCode;
  /** The reference the widget asked for, as it passed it. */
  readonly ref: string;

  constructor(code: WidgetAssetErrorCode, ref: string, message?: string) {
    super(message ?? `asset ${ref}: ${code}`);
    this.name = "WidgetAssetError";
    this.code = code;
    this.ref = ref;
  }
}

/** Path prefixes of the files the engine stores for widgets to read. Must
 *  match `ALLOWED_TOP_LEVEL_PREFIXES` in barkloader/app/src/routes/assets.rs. */
export const ENGINE_ASSET_PREFIXES = ["/assets/user/", "/assets/modules/"] as const;

/**
 * The engine path a widget's asset reference names, or null when it names no
 * engine file. A reference is a picker value (`{ url }`), an absolute URL, or
 * a path relative to the widget's own resources (`resourceBaseUrl`).
 *
 * Only the path is kept. The engine is reachable under more than one origin
 * (its configured public URL, the address an overlay was opened with), so an
 * engine file is recognised by where it sits, and the host always reads it
 * from its own engine. A URL on another host that happens to share the
 * prefix can therefore only ever read this engine's file of that name.
 */
export function engineAssetPath(ref: string, resourceBaseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(ref, resourceBaseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  return ENGINE_ASSET_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)) ? url.pathname : null;
}

/** The URL a reference carries: the string itself, or a picker value's `url`. */
export function assetRefUrl(ref: unknown): string | null {
  if (typeof ref === "string") {
    return ref === "" ? null : ref;
  }
  if (typeof ref === "object" && ref !== null && typeof (ref as { url?: unknown }).url === "string") {
    const url = (ref as { url: string }).url;
    return url === "" ? null : url;
  }
  return null;
}

/** A `WidgetAsset` over bytes the host read. */
export function createWidgetAsset(path: string, contentType: string, bytes: ArrayBuffer): WidgetAsset {
  return Object.freeze({
    path,
    contentType,
    bytes,
    text(): string {
      return new TextDecoder().decode(bytes);
    },
    json(): unknown {
      return JSON.parse(new TextDecoder().decode(bytes));
    },
  });
}
