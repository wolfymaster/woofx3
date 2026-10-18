// What every route answers with and reads by the same rules: JSON errors,
// the scene session check, and request bodies read under a size limit.

import { readSessionCookie } from "../scene/session-cookie";
import type { SessionClaims, SessionTokenService } from "../scene/session-token";

/** Responses carrying session-scoped or live state are never cached. */
export const NO_STORE: Readonly<Record<string, string>> = Object.freeze({ "Cache-Control": "no-store" });

/** `{ error: code, ...detail }` with `status`, as JSON, never cached. */
export function jsonError(status: number, code: string, detail: Record<string, unknown> = {}): Response {
  return Response.json({ error: code, ...detail }, { status, headers: NO_STORE });
}

/** `body` as JSON, never cached. */
export function jsonOk(body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { headers: { ...NO_STORE, ...headers } });
}

/**
 * The claims of the scene session the request's cookie holds for `sceneId`,
 * or null when it holds none, an invalid one, or one for another scene. The
 * one check every route an overlay page calls makes.
 */
export async function requireSceneSession(
  req: Request,
  sceneId: string,
  tokens: Pick<SessionTokenService, "verify">
): Promise<SessionClaims | null> {
  const cookie = readSessionCookie(req, sceneId);
  const claims = cookie ? await tokens.verify(cookie) : null;
  return claims !== null && claims.sceneId === sceneId ? claims : null;
}

/** The 401 a route answers when `requireSceneSession` finds no session. */
export function invalidSession(): Response {
  return jsonError(401, "invalid_session");
}

/**
 * Largest request body each kind of route reads, in bytes. The server-wide
 * limit is set for uploads, which are streamed and never read here; a route
 * that reads its body whole must not buffer anything near that.
 */
export const BODY_LIMITS = {
  /** `{ instanceIds }` for one event. */
  ack: 16 * 1024,
  /** One widget status report. */
  status: 64 * 1024,
  /** A scene's placements: a few kilobytes in practice. */
  placements: 1024 * 1024,
} as const;

export type BodyRead<T> = { ok: true; value: T } | { ok: false; response: Response };

/**
 * The request body as text, read no further than `maxBytes`: a declared
 * length over it is refused before reading, and a body that turns out longer
 * is refused as soon as it passes it (413 `too_large`).
 */
export async function readTextBody(req: Request, maxBytes: number): Promise<BodyRead<string>> {
  const declared = Number(req.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, response: jsonError(413, "too_large") };
  }
  if (req.body === null) {
    return { ok: true, value: "" };
  }
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, response: jsonError(413, "too_large") };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, value: new TextDecoder().decode(bytes) };
}

/** The request body parsed as JSON, read as `readTextBody` reads it; 400 `invalid_body` when it is not JSON. */
export async function readJsonBody(req: Request, maxBytes: number): Promise<BodyRead<unknown>> {
  const text = await readTextBody(req, maxBytes);
  if (!text.ok) {
    return text;
  }
  try {
    return { ok: true, value: JSON.parse(text.value) as unknown };
  } catch {
    return { ok: false, response: jsonError(400, "invalid_body") };
  }
}
