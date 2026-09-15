import { routeModule } from "./context";
import { resolveSceneManagerUrl, timestampToIso } from "./helpers";

/**
 * Gateway implementation of `Woofx3EngineApi`'s overlay-token methods (see
 * that interface in @woofx3/api for the full contract doc comments). The
 * DB/Twirp layer (`db/app/services/overlay_token_service.go`, wired via
 * `db-client.ts`'s mintOverlayToken/revokeOverlayToken/rotateOverlayToken/
 * listOverlayTokens) already existed; this file is the missing gateway link
 * that exposes it to capnweb callers (Convex).
 */

interface OverlayTokenRow {
  id: string;
  token: string;
  sceneId: string;
  applicationId: string;
  label: string;
  status: string;
  createdAt: { seconds?: bigint; nanos?: number } | undefined;
}

/**
 * NOTE: this URL shape is what Convex is expected to consume for the
 * scene-manager palette; verify against the live Convex integration
 * before relying on it — see the sceneManager migration notes.
 */
function buildOverlayUrl(sceneManagerUrl: string, sceneId: string, token: string): string {
  return `${sceneManagerUrl.replace(/\/+$/, "")}/scene/${sceneId}?token=${token}`;
}

function toMintedResult(sceneManagerUrl: string, row: OverlayTokenRow) {
  return {
    tokenId: row.id,
    token: row.token,
    sceneId: row.sceneId,
    applicationId: row.applicationId,
    label: row.label,
    status: row.status,
    createdAt: timestampToIso(row.createdAt),
    url: buildOverlayUrl(sceneManagerUrl, row.sceneId, row.token),
  };
}

export const overlayTokenRoutes = routeModule({
  async mintOverlayToken(input: { sceneId: string; label?: string }) {
    const applicationId = await this.ensureApplicationId();
    const [result, sceneManagerUrl] = await Promise.all([
      this.db.mintOverlayToken({
        sceneId: input.sceneId,
        applicationId,
        label: input.label ?? "",
      }),
      resolveSceneManagerUrl(this.db, this.sceneManagerUrl),
    ]);
    return toMintedResult(sceneManagerUrl, result.overlayToken);
  },

  async revokeOverlayToken(input: { tokenId: string }): Promise<{ tokenId: string; status: string }> {
    const result = await this.db.revokeOverlayToken({ id: input.tokenId });
    return { tokenId: result.overlayToken.id, status: result.overlayToken.status };
  },

  async rotateOverlayToken(input: { tokenId: string; label?: string }) {
    const [result, sceneManagerUrl] = await Promise.all([
      this.db.rotateOverlayToken({ id: input.tokenId }),
      resolveSceneManagerUrl(this.db, this.sceneManagerUrl),
    ]);
    return toMintedResult(sceneManagerUrl, result.overlayToken);
  },

  async listOverlayTokens(input?: { sceneId?: string; page?: number; pageSize?: number }) {
    const applicationId = await this.ensureApplicationId();
    const [result, sceneManagerUrl] = await Promise.all([
      this.db.listOverlayTokens({
        sceneId: input?.sceneId ?? "",
        applicationId,
        includeRevoked: false,
      }),
      resolveSceneManagerUrl(this.db, this.sceneManagerUrl),
    ]);
    return (result.overlayTokens ?? []).map((row) => ({
      tokenId: row.id,
      token: row.token,
      sceneId: row.sceneId,
      label: row.label,
      status: row.status,
      createdAt: timestampToIso(row.createdAt),
      url: buildOverlayUrl(sceneManagerUrl, row.sceneId, row.token),
    }));
  },
});
