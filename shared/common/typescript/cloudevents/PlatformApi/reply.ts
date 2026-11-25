/**
 * The reply envelope every `<platform>api` subject (`twitchapi`, `kickapi`)
 * answers with: a CloudEvent whose `source` is the subject, typed
 * `<subject>.<command>.result` on success and `<subject>.error` on refusal.
 * Sandbox and api callers parse these types, so they are wire names.
 */

/**
 * Every `code` an error reply can carry: an actionable platform refusal,
 * `not_linked` (no account is linked), or `integration_unavailable` (linked,
 * but the adapter is turned off or not running). The connectors host sends
 * the last two for any command while the adapter is down.
 */
export const PLATFORM_API_REPLY_CODES = [
  "missing_scope",
  "unauthorized",
  "rate_limited",
  "invalid_arguments",
  "not_linked",
  "integration_unavailable",
] as const;

export type PlatformApiReplyCode = (typeof PLATFORM_API_REPLY_CODES)[number];

export function isPlatformApiReplyCode(code: unknown): code is PlatformApiReplyCode {
  return PLATFORM_API_REPLY_CODES.some((known) => known === code);
}

/** The CloudEvent type of every refusal on `subject`. */
export function platformApiErrorType(subject: string): string {
  return `${subject}.error`;
}

/** The CloudEvent type of a successful reply to `command` on `subject`. */
export function platformApiResultType(subject: string, command: string): string {
  return `${subject}.${command}.result`;
}

/** What stamping a reply needs: the time it is sent and a fresh event id. */
export interface PlatformApiReplyDeps {
  clock: { now(): number };
  ids: { next(): string };
}

/** A reply on `subject`: a CloudEvent of `type` around `data`. */
export function encodePlatformApiReply(
  subject: string,
  type: string,
  data: unknown,
  deps: PlatformApiReplyDeps
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      id: deps.ids.next(),
      type,
      source: subject,
      time: new Date(deps.clock.now()).toISOString(),
      data,
    })
  );
}

/**
 * A refusal on `subject`. `code` is set when the failure is one a caller can
 * act on differently (`missing_scope` means relink, `rate_limited` means
 * wait); absent for everything else.
 */
export function encodePlatformApiError(
  subject: string,
  error: string,
  code: PlatformApiReplyCode | undefined,
  deps: PlatformApiReplyDeps
): Uint8Array {
  return encodePlatformApiReply(subject, platformApiErrorType(subject), code ? { error, code } : { error }, deps);
}
