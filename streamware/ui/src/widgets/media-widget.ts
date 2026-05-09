import { resolve, type ResolverContext } from "../lib/resolver";
import type { LegacyAlertPayload, MessageOptions } from "../types";
import type { Widget } from "./index";

/**
 * MediaWidget — generic text/media/audio renderer with expression-based
 * substitution. Encapsulates streamware's previous AlertMessage behavior
 * plus a real template language: paths, ternaries, comparisons, string
 * concat — see lib/resolver.ts for the grammar — AND preserves the
 * legacy `{primary}` color-tag substitution from streamlabs.
 *
 * Author writes in their workflow's `alert` action parameters:
 *   {
 *     widget: "MediaWidget",
 *     text: "{primary}{event.data.userName}{primary} cheered "
 *         + "{event.data.amount} {event.data.amount > 1 ? 'bits' : 'bit'}",
 *     mediaUrl: "...",
 *     audioUrl: "...",
 *     duration: 5,
 *     options: { ... },
 *   }
 *
 * Render pipeline for each text-bearing field:
 *   raw → {primary} legacy substitution → expression resolution → output
 * `{primary}` is processed first so its expanded HTML (which contains no
 * `{...}` segments) survives the resolver pass untouched.
 */

// Legacy color-tag table from streamlabs. Pre-processed before expression
// resolution. `{primary}…{primary}` alternates open/close — first hit
// emits the opening tag, second emits the closing tag, third opens
// again, etc. Open-ended shape so future tags drop in as one row.
const LEGACY_TAGS: Record<string, { open: string; close: string }> = {
  "{primary}": {
    open: '<span style="color: #EC6758">',
    close: "</span>",
  },
};

export const mediaWidget: Widget = {
  id: "MediaWidget",
  render({ id, parameters, event }) {
    // Spread parameters first so a stray `event` key in parameters cannot
    // shadow the engine-attached event.
    const ctx: ResolverContext = { ...parameters, event };

    const text = renderField(parameters.text, ctx);
    const mediaUrl = renderField(parameters.mediaUrl, ctx);
    const audioUrl = renderField(parameters.audioUrl, ctx);
    // Pass duration through verbatim — `undefined` is meaningful and
    // tells AlertAudio / AlertMessage to play the audio to completion
    // rather than truncating at a default 5s window. When the author
    // explicitly sets `duration`, that's the hard ceiling for the
    // whole alert (text + audio both stop at duration).
    const duration = pickOptionalNumber(parameters.duration);
    const options = parameters.options as MessageOptions | MessageOptions[] | undefined;

    if (!hasContent(text) && !hasContent(mediaUrl) && !hasContent(audioUrl)) {
      return null;
    }

    return {
      // Use the envelope id so React keys + downstream effect deps stay
      // stable across parent re-renders. Falling back to a random uuid
      // would make AlertAudio tear down + restart on every render.
      id: typeof parameters.id === "string" ? parameters.id : id,
      type: "alert_message",
      text,
      mediaUrl,
      audioUrl,
      duration,
      options,
    };
  },
};

/**
 * Resolve a single field value against the context. Accepts `string` or
 * `string[]`; arrays preserve their shape so AlertWrapper can iterate
 * and pair indexed entries (mediaUrl[i] with options[i] etc.). Each
 * string element runs through legacy `{primary}` expansion + the
 * resolver. Any other shape (number, object, undefined) returns
 * undefined so the widget treats it as absent.
 */
function renderField(value: unknown, ctx: ResolverContext): string | string[] | undefined {
  if (typeof value === "string") {
    return resolveOne(value, ctx);
  }
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? resolveOne(item, ctx) ?? "" : ""));
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
      // Even index → just emitted closing (or start of string); next opens.
      // Odd index  → just emitted opening; next closes.
      return acc + segment + (index % 2 === 0 ? open : close);
    }, "");
  }
  return result;
}

function pickNumber(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function pickOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
