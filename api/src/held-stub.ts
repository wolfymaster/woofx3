/**
 * Keeping a client's callback past the call that delivered it.
 *
 * capnweb disposes every stub a call receives in its parameters when that call
 * returns, so a callback kept for later pushes must be duplicated, and the
 * duplicate released once it is no longer used. A plain object, as an
 * in-process caller or a test passes, has none of these methods and is kept
 * as it is.
 */

type StubMethods = Partial<{
  dup(): unknown;
  onRpcBroken(listener: (error: unknown) => void): void;
  [Symbol.dispose](): void;
}>;

/** A copy of `callback` that outlives the call it arrived in. Pair with `releaseStub`. */
export function holdStub<T extends object>(callback: T): T {
  const stub = callback as StubMethods;
  return typeof stub.dup === "function" ? (stub.dup() as T) : callback;
}

/** Releases a callback taken with `holdStub`. */
export function releaseStub(held: object): void {
  (held as StubMethods)[Symbol.dispose]?.();
}

/** Calls `listener` once the held callback's session is gone. */
export function onStubBroken(held: object, listener: (error: unknown) => void): void {
  (held as StubMethods).onRpcBroken?.(listener);
}
