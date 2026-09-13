import type { InboundWebhookResponse } from "@woofx3/api";

/** Largest response body a handler may return, encoded. */
export const MAX_RESPONSE_BODY_BYTES = 64 * 1024;
/** Most events one request may produce. */
export const MAX_EVENTS = 16;
/** Largest `data` one event may carry, serialized. */
export const MAX_EVENT_DATA_BYTES = 64 * 1024;

export interface HandlerEvent {
  type: string;
  data: Record<string, unknown>;
}

export type HandlerResultCheck =
  | { ok: true; response: InboundWebhookResponse; events: HandlerEvent[] }
  | { ok: false; reason: string };

type Checked<T> = { ok: true; value: T } | { ok: false; reason: string };

const RESULT_KEYS = new Set(["status", "headers", "body", "events"]);
const EVENT_KEYS = new Set(["type", "data"]);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9a-z-]+$/;

/**
 * Check what a webhook handler returned before the engine acts on any of it.
 *
 * Fail closed: a result that breaks any rule is rejected whole, so a handler
 * bug can never publish part of what it meant to or answer with a malformed
 * response. `allowedEventTypes` are the `event`s of the module's own active
 * eventbus triggers; a handler cannot publish anything else.
 */
export function validateWebhookHandlerResult(
  result: unknown,
  allowedEventTypes: ReadonlySet<string>
): HandlerResultCheck {
  if (!isPlainObject(result)) {
    return { ok: false, reason: "the handler must return an object" };
  }
  const unknownKey = Object.keys(result).find((key) => !RESULT_KEYS.has(key));
  if (unknownKey !== undefined) {
    return { ok: false, reason: `unknown result field ${JSON.stringify(unknownKey)}` };
  }

  const status = result.status;
  if (typeof status !== "number" || !Number.isInteger(status) || status < 200 || status > 599) {
    return { ok: false, reason: "status must be an integer from 200 to 599" };
  }

  const headers = checkHeaders(result.headers);
  if (!headers.ok) {
    return headers;
  }
  const body = encodeBody(result.body);
  if (!body.ok) {
    return body;
  }
  const events = checkEvents(result.events, status, allowedEventTypes);
  if (!events.ok) {
    return events;
  }

  const responseHeaders = { ...headers.value };
  if (body.value.contentType !== undefined && responseHeaders["content-type"] === undefined) {
    responseHeaders["content-type"] = body.value.contentType;
  }
  return {
    ok: true,
    response: { status, headers: responseHeaders, body: body.value.text },
    events: events.value,
  };
}

function checkHeaders(raw: unknown): Checked<Record<string, string>> {
  if (raw === undefined) {
    return { ok: true, value: {} };
  }
  if (!isPlainObject(raw)) {
    return { ok: false, reason: "headers must be an object" };
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    const lower = name.toLowerCase();
    if (!HEADER_NAME.test(lower) || (lower !== "content-type" && !lower.startsWith("x-"))) {
      return { ok: false, reason: `header ${JSON.stringify(name)} is not allowed; only content-type and x-* are` };
    }
    if (typeof value !== "string") {
      return { ok: false, reason: `header ${JSON.stringify(name)} must be a string` };
    }
    headers[lower] = value;
  }
  return { ok: true, value: headers };
}

function encodeBody(raw: unknown): Checked<{ text: string; contentType?: string }> {
  if (raw === undefined) {
    return { ok: true, value: { text: "" } };
  }
  let encoded: { text: string; contentType: string };
  if (typeof raw === "string") {
    encoded = { text: raw, contentType: "text/plain; charset=utf-8" };
  } else if (Array.isArray(raw) || isPlainObject(raw)) {
    encoded = { text: JSON.stringify(raw), contentType: "application/json" };
  } else {
    return { ok: false, reason: "body must be a string, an object or an array" };
  }
  if (utf8Length(encoded.text) > MAX_RESPONSE_BODY_BYTES) {
    return { ok: false, reason: `body exceeds ${MAX_RESPONSE_BODY_BYTES} bytes` };
  }
  return { ok: true, value: encoded };
}

function checkEvents(raw: unknown, status: number, allowedEventTypes: ReadonlySet<string>): Checked<HandlerEvent[]> {
  if (raw === undefined) {
    return { ok: true, value: [] };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, reason: "events must be an array" };
  }
  if (raw.length === 0) {
    return { ok: true, value: [] };
  }
  if (status < 200 || status > 299) {
    return { ok: false, reason: "events are only allowed with a 2xx status" };
  }
  if (raw.length > MAX_EVENTS) {
    return { ok: false, reason: `at most ${MAX_EVENTS} events per request` };
  }
  const events: HandlerEvent[] = [];
  for (const [i, entry] of raw.entries()) {
    if (!isPlainObject(entry)) {
      return { ok: false, reason: `events[${i}] must be an object` };
    }
    const unknownKey = Object.keys(entry).find((key) => !EVENT_KEYS.has(key));
    if (unknownKey !== undefined) {
      return { ok: false, reason: `events[${i}] has unknown field ${JSON.stringify(unknownKey)}` };
    }
    if (typeof entry.type !== "string" || !allowedEventTypes.has(entry.type)) {
      return {
        ok: false,
        reason: `events[${i}].type ${JSON.stringify(entry.type)} is not an eventbus trigger this module declares`,
      };
    }
    const data = entry.data ?? {};
    if (!isPlainObject(data)) {
      return { ok: false, reason: `events[${i}].data must be an object` };
    }
    if (utf8Length(JSON.stringify(data)) > MAX_EVENT_DATA_BYTES) {
      return { ok: false, reason: `events[${i}].data exceeds ${MAX_EVENT_DATA_BYTES} bytes` };
    }
    events.push({ type: entry.type, data });
  }
  return { ok: true, value: events };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}
