import { jwtVerify, SignJWT } from "jose";
import {
  COMPOSITION_PREVIEW_PATH,
  type CompositionPreviewTokenReply,
} from "@woofx3/common/cloudevents/Scene/composition-preview";
import { sceneEditorPath, type SceneEditorTokenReply } from "@woofx3/common/cloudevents/Scene/editor";

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
 * short-lived credential in the first place.
 *
 * Instead an overlay's session records when its overlay token was last
 * verified (`authAt`), and a refresh past `SESSION_REAUTH_SECONDS` of that
 * must present the token again (routes/session.ts): the page sends the one
 * in its URL, so an open overlay re-verifies without reloading, and a
 * revoked token stops it within that long rather than never.
 */
export interface SessionClaims {
  sceneId: string;
}

/** An overlay's session: its scene, and when its overlay token was last verified (unix seconds). */
export interface OverlaySession extends SessionClaims {
  authAt: number;
}

/** Token lifetime: 60s, refreshed pre-emptively by the client every ~50s. */
export const SESSION_TOKEN_TTL_SECONDS = 60;

/**
 * How long an overlay's session renews without its overlay token being
 * verified again: the longest a revoked token keeps an open overlay going.
 */
export const SESSION_REAUTH_SECONDS = 600;

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

/** The current time as JWT times are kept: whole unix seconds. */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export class SessionTokenService {
  private readonly key: Uint8Array;

  constructor(secret: string) {
    if (!secret) {
      throw new Error("SessionTokenService requires a non-empty secret");
    }
    this.key = new TextEncoder().encode(secret);
  }

  async mint(session: OverlaySession): Promise<string> {
    return new SignJWT({ sceneId: session.sceneId, authAt: session.authAt })
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
  async verify(token: string): Promise<OverlaySession | null> {
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

  private async claims(token: string, editor: boolean): Promise<OverlaySession | null> {
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
      // A session minted before `authAt` existed was verified when it was
      // first issued at the latest, which its own iat bounds from above.
      const authAt = typeof payload.authAt === "number" ? payload.authAt : (payload.iat ?? 0);
      return { sceneId, authAt };
    } catch {
      return null;
    }
  }
}

/**
 * The replies to the api's requests for an editor token and a preview token
 * (`engine.scene.editor.token`, `engine.composition.preview.token`): the
 * token, how long it lives, and the path it opens.
 */
export function sceneTokenIssuer(
  tokens: SessionTokenService,
  sceneExists: (sceneId: string) => Promise<boolean>
): {
  editorToken(sceneId: string): Promise<SceneEditorTokenReply>;
  previewToken(): Promise<CompositionPreviewTokenReply>;
} {
  return {
    editorToken: async (sceneId) => {
      if (!(await sceneExists(sceneId))) {
        return { ok: false, reason: "scene not found" };
      }
      return {
        ok: true,
        token: await tokens.mintEditor({ sceneId }),
        expiresInSeconds: EDITOR_TOKEN_TTL_SECONDS,
        path: sceneEditorPath(sceneId),
      };
    },
    previewToken: async () => ({
      ok: true,
      token: await tokens.mintPreview(),
      expiresInSeconds: PREVIEW_TOKEN_TTL_SECONDS,
      path: COMPOSITION_PREVIEW_PATH,
    }),
  };
}
