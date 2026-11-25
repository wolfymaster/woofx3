import type { KickTokenGrant } from "@woofx3/api/webhooks";
import { err, ok, type ParseResult } from "../utils";

/**
 * The subject the api answers the linked Kick account's token on. The
 * request is `{ force?: boolean }`; `force` asks for a renewal because Kick
 * refused the token.
 */
export const KICK_TOKEN_SUBJECT = "engine.kick.token";

/**
 * Why no token came back: `not_linked` (no Kick account is linked),
 * `relink_required` (the dashboard can no longer renew it; the streamer has
 * to link Kick again), `unavailable` (it could not be renewed right now).
 */
export const KICK_TOKEN_UNAVAILABLE_REASONS = ["not_linked", "relink_required", "unavailable"] as const;

export type KickTokenUnavailableReason = (typeof KICK_TOKEN_UNAVAILABLE_REASONS)[number];

export type KickTokenReply =
  | { token: KickTokenGrant }
  | { token: null; reason: KickTokenUnavailableReason; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReason(value: unknown): value is KickTokenUnavailableReason {
  return KICK_TOKEN_UNAVAILABLE_REASONS.some((reason) => reason === value);
}

/** Reads an `engine.kick.token` reply, refusing anything that is not one. */
export function parseKickTokenReply(body: unknown): ParseResult<KickTokenReply> {
  if (!isRecord(body)) {
    return err("is not an object");
  }
  if (body.token === null) {
    if (!isReason(body.reason) || typeof body.error !== "string") {
      return err("refuses without a known reason");
    }
    return ok({ token: null, reason: body.reason, error: body.error });
  }
  if (!isRecord(body.token)) {
    return err("has no token");
  }
  const { userId, accessToken, scope, expiresIn, obtainmentTimestamp, clientId } = body.token;
  if (
    typeof userId !== "string" ||
    userId === "" ||
    typeof accessToken !== "string" ||
    accessToken === "" ||
    typeof clientId !== "string" ||
    !Array.isArray(scope) ||
    !scope.every((s) => typeof s === "string") ||
    typeof expiresIn !== "number" ||
    typeof obtainmentTimestamp !== "number"
  ) {
    return err("has a malformed token");
  }
  return ok({ token: { userId, accessToken, scope, expiresIn, obtainmentTimestamp, clientId } });
}
