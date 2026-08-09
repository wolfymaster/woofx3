import { jwtVerify, SignJWT } from "jose";

/**
 * Short-lived session credential minted at `GET /scene/{sceneId}?token=`
 * once the opaque overlay token has been verified, and carried
 * thereafter as an HttpOnly session cookie — every subsequent
 * same-origin request (widget frames, refresh, events, status,
 * completion acks) trusts this instead of re-presenting the original
 * long-lived credential.
 *
 * Claims are deliberately minimal: `overlay_token.proto`'s
 * `ResolveOverlayToken` RPC returns only `{sceneId, applicationId}` —
 * no token row id — by design (uniform NOT_FOUND for revoked/unknown
 * tokens, no enumeration oracle). So there is no id to key a
 * DB-recheckable `sub` claim on without embedding the plaintext opaque
 * token itself, which would defeat the point of exchanging it for a
 * short-lived credential in the first place. The tradeoff this
 * implies: revoking an overlay token takes effect on the *next* full
 * page load (fresh `?token=` verification), not instantly mid-session
 * — the same behavior most session-cookie systems have.
 */
export interface SessionClaims {
  sceneId: string;
  applicationId: string;
}

/** Token lifetime: 60s, refreshed pre-emptively by the client every ~50s. */
export const SESSION_TOKEN_TTL_SECONDS = 60;

export class SessionTokenService {
  private readonly key: Uint8Array;

  constructor(secret: string) {
    if (!secret) {
      throw new Error("SessionTokenService requires a non-empty secret");
    }
    this.key = new TextEncoder().encode(secret);
  }

  async mint(claims: SessionClaims): Promise<string> {
    return new SignJWT({ sceneId: claims.sceneId, applicationId: claims.applicationId })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${SESSION_TOKEN_TTL_SECONDS}s`)
      .sign(this.key);
  }

  /** Verifies signature + expiry and returns the claims, or `null` for
   *  any failure (expired, tampered, malformed) — uniform, no detail
   *  leaked to the caller. */
  async verify(token: string): Promise<SessionClaims | null> {
    if (!token) {
      return null;
    }
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"] });
      const sceneId = payload.sceneId;
      const applicationId = payload.applicationId;
      if (typeof sceneId !== "string" || !sceneId || typeof applicationId !== "string" || !applicationId) {
        return null;
      }
      return { sceneId, applicationId };
    } catch {
      return null;
    }
  }
}
