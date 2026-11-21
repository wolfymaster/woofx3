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

/** What a generated validator is: a type guard that leaves its problems in `errors`. */
export type ContractValidator<T> = ((value: unknown) => value is T) & {
  errors?: { instancePath?: string; message?: string }[] | null;
};

/** The value as the contract's type, or the first place it does not fit. */
export function parseContract<T>(validate: ContractValidator<T>, value: unknown): ParseResult<T> {
  if (validate(value)) {
    return ok(value);
  }
  const [first] = validate.errors ?? [];
  const path = (first?.instancePath ?? "").split("/").filter(Boolean).join(".");
  const detail = first?.message ?? "does not match the contract";
  return err(path ? `${path}: ${detail}` : detail);
}

/**
 * The bytes to publish for an event, checked as they will be read: after JSON serialisation, which is what drops
 * an undefined attribute and turns a Date into text. Throws when the event does not fit its contract, since a
 * publisher that sends a message its readers refuse has a bug no retry fixes.
 */
export function encodeContract<T>(validate: ContractValidator<T>, event: unknown): Uint8Array {
  const bytes = encode(event);
  const checked = parseContract(validate, JSON.parse(new TextDecoder().decode(bytes)));
  if (!checked.ok) {
    throw new Error(`event does not fit its contract: ${checked.error}`);
  }
  return bytes;
}

/** The value as a plain object, or null for anything else, arrays included. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
