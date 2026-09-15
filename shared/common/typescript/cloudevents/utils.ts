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
