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
 * `ResolveOverlayToken` RPC returns only `{sceneId}` —
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
}

/** Token lifetime: 60s, refreshed pre-emptively by the client every ~50s. */
export const SESSION_TOKEN_TTL_SECONDS = 60;

/**
 * An editor token is only presented when the editor socket opens, so it
 * needs to live only as long as it takes the dashboard to connect; a
 * reconnect asks for a new one.
 */
export const EDITOR_TOKEN_TTL_SECONDS = 300;

/** The claim that makes a token an editor's. */
const EDIT_SCOPE = "edit";

/**
 * The composition preview's tokens (see routes/composition-preview.ts): one
 * that opens the page, minted for the dashboard through the api and presented
 * once, and the page's session after. They name no scene, so neither ever
 * verifies as an overlay's session or an editor's token, and those never
 * verify as either of these.
 */
const PREVIEW_SCOPE = "composition-preview";
const PREVIEW_SESSION_SCOPE = "composition-preview-session";

/** As an editor token: long enough for the dashboard to load the page it was minted for. */
export const PREVIEW_TOKEN_TTL_SECONDS = 300;

export class SessionTokenService {
  private readonly key: Uint8Array;

  constructor(secret: string) {
    if (!secret) {
      throw new Error("SessionTokenService requires a non-empty secret");
    }
    this.key = new TextEncoder().encode(secret);
  }

  async mint(claims: SessionClaims): Promise<string> {
    return new SignJWT({ sceneId: claims.sceneId })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${SESSION_TOKEN_TTL_SECONDS}s`)
      .sign(this.key);
  }

  /** A token that lets its holder edit one scene, minted for the dashboard
   *  through the api (see `SCENE_EDITOR_TOKEN_SUBJECT`). */
  async mintEditor(claims: SessionClaims): Promise<string> {
    return new SignJWT({ sceneId: claims.sceneId, scope: EDIT_SCOPE })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${EDITOR_TOKEN_TTL_SECONDS}s`)
      .sign(this.key);
  }

  /** Verifies signature + expiry and returns the claims, or `null` for
   *  any failure (expired, tampered, malformed) — uniform, no detail
   *  leaked to the caller. An editor token is not a session. */
  async verify(token: string): Promise<SessionClaims | null> {
    return this.claims(token, false);
  }

  /** Verifies an editor token: as `verify`, and it must carry the edit scope.
   *  An overlay's session never lets its holder edit the scene. */
  async verifyEditor(token: string): Promise<SessionClaims | null> {
    return this.claims(token, true);
  }

  /** A token that opens the composition preview page, minted for the dashboard through the api. */
  async mintPreview(): Promise<string> {
    return this.mintScoped(PREVIEW_SCOPE, PREVIEW_TOKEN_TTL_SECONDS);
  }

  /** The preview page's session, carried as a cookie and refreshed like an overlay's. */
  async mintPreviewSession(): Promise<string> {
    return this.mintScoped(PREVIEW_SESSION_SCOPE, SESSION_TOKEN_TTL_SECONDS);
  }

  async verifyPreview(token: string): Promise<boolean> {
    return this.hasScope(token, PREVIEW_SCOPE);
  }

  async verifyPreviewSession(token: string): Promise<boolean> {
    return this.hasScope(token, PREVIEW_SESSION_SCOPE);
  }

  private async mintScoped(scope: string, ttlSeconds: number): Promise<string> {
    return new SignJWT({ scope })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(this.key);
  }

  private async hasScope(token: string, scope: string): Promise<boolean> {
    if (!token) {
      return false;
    }
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"] });
      return payload.scope === scope && payload.sceneId === undefined;
    } catch {
      return false;
    }
  }

  private async claims(token: string, editor: boolean): Promise<SessionClaims | null> {
    if (!token) {
      return null;
    }
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"] });
      const sceneId = payload.sceneId;
      if (typeof sceneId !== "string" || !sceneId) {
        return null;
      }
      if ((payload.scope === EDIT_SCOPE) !== editor) {
        return null;
      }
      return { sceneId };
    } catch {
      return null;
    }
  }
}
