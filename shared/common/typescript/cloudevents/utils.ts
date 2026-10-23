export function encode(event: any): Uint8Array {
  const payload = JSON.stringify(event);
  return new TextEncoder().encode(payload);
}

/**
 * `args` is generic rather than Record<string, unknown> because every caller
 * passes a declared interface, and an interface has no implicit index
 * signature - so FollowArgs, TimeoutArgs and friends were all rejected. The
 * body only JSON-encodes, so any object shape is fine.
 */
export function encodeCommand<TArgs extends object>(payload: { command: string; args: TArgs }): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

/** The outcome of checking a value from outside the engine: the checked value, or the first problem found. */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function ok<T>(value: T): ParseResult<T> {
  return { ok: true, value };
}

export function err(error: string): ParseResult<never> {
  return { ok: false, error };
}

/** The value as a plain object, or null for anything else, arrays included. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
