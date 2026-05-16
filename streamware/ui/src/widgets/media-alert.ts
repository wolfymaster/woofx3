import { resolve, type ResolverContext } from "../lib/resolver";
import type { LegacyAlertPayload, MessageOptions } from "../types";
import type { Widget, WidgetInput } from "./index";

/**
 * Media Alert — generic text/media/audio renderer with expression-based
 * substitution. The canonical built-in alert widget that ships with
 * woofx3, replacing the previous hardcoded MediaWidget pattern.
 *
 * This is the RENDERER component of the built-in "media_alert" widget.
 * The widget DEFINITION (WidgetDefinition metadata) is declared in the
 * backend's `builtin-widgets.ts` and served via `/api/builtin-widgets`.
 *
 * Author writes in their workflow's `alert` action parameters:
 *   {
 *     widget: "media_alert",
 *     text: "{primary}{event.data.userName}{primary} cheered "
 *         + "{event.data.amount} {event.data.amount > 1 ? 'bits' : 'bit'}",
 *     mediaUrl: "...",
 *     audioUrl: "...",
 *     duration: 5,
 *   }
 *
 * Render pipeline for each text-bearing field:
 *   raw {primary} legacy substitution  expression resolution  output
 * `{primary}` is processed first so its expanded HTML (which contains no
 * `{...}` segments) survives the resolver pass untouched.
 *
 * Backward-compatible: the legacy "MediaWidget" id is aliased during
 * built-in widget initialisation so existing workflow alert actions
 * continue to resolve without updating their `widget` parameter.
 */

// Legacy color-tag table from streamlabs. Pre-processed before expression
// resolution. `{primary}…{primary}` alternates open/close so the tags nest
// correctly in composed alert text. Open-ended shape for future tags.
const LEGACY_TAGS: Record<string, { open: string; close: string }> = {
  "{primary}": {
    open: '<span style="color: #EC6758">',
    close: "</span>",
  },
};

function render({ id, parameters, event }: WidgetInput): LegacyAlertPayload | null {
  const ctx: ResolverContext = { ...parameters, event };

  const text = renderField(parameters.text, ctx);
  const mediaUrl = renderField(parameters.mediaUrl, ctx);
  const audioUrl = renderField(parameters.audioUrl, ctx);
  const duration = pickOptionalNumber(parameters.duration);
  const options = parameters.options as MessageOptions | MessageOptions[] | undefined;

  if (!hasContent(text) && !hasContent(mediaUrl) && !hasContent(audioUrl)) {
    return null;
  }

  return {
    id: typeof parameters.id === "string" ? parameters.id : id,
    type: "alert_message",
    text,
    mediaUrl,
    audioUrl,
    duration,
    options,
  };
}

export const mediaAlertWidget: Widget = {
  id: "media_alert",
  render,
};

/** Alias for backward compatibility — workflows referencing the old
 *  "MediaWidget" id still resolve. Removed once all workflows have
 *  been migrated to the new "media_alert" id. */
export const MEDIA_ALERT_LEGACY_ID = "MediaWidget";
export const legacyAliasWidget: Widget = {
  id: MEDIA_ALERT_LEGACY_ID,
  render,
};

function renderField(value: unknown, ctx: ResolverContext): string | string[] | undefined {
  if (typeof value === "string") {
    return resolveOne(value, ctx);
  }
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? (resolveOne(item, ctx) ?? "") : ""));
  }
  return undefined;
}

function resolveOne(value: string, ctx: ResolverContext): string | undefined {
  const withTags = expandLegacyTags(value);
  const resolved = resolve(withTags, ctx);
  if (resolved === undefined || resolved === null) {
    return undefined;
  }
  return String(resolved);
}

function hasContent(value: string | string[] | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === "string") return value.length > 0;
  return value.some((s) => s.length > 0);
}

function expandLegacyTags(input: string): string {
  let result = input;
  for (const [token, { open, close }] of Object.entries(LEGACY_TAGS)) {
    if (!result.includes(token)) {
      continue;
    }
    const segments = result.split(token);
    result = segments.reduce((acc, segment, index) => {
      if (index === segments.length - 1) {
        return acc + segment;
      }
      return acc + segment + (index % 2 === 0 ? open : close);
    }, "");
  }
  return result;
}

function pickOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
