import { resolveOverlayPublicUrl, timestampToIso } from "./helpers";

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

function buildOverlayUrl(overlayPublicUrl: string, token: string): string {
  return `${overlayPublicUrl.replace(/\/+$/, "")}/overlay/${token}/`;
}

function toMintedResult(overlayPublicUrl: string, row: OverlayTokenRow) {
  return {
    tokenId: row.id,
    token: row.token,
    sceneId: row.sceneId,
    applicationId: row.applicationId,
    label: row.label,
    status: row.status,
    createdAt: timestampToIso(row.createdAt),
    url: buildOverlayUrl(overlayPublicUrl, row.token),
  };
}

export const overlayTokenRoutes = {
  async mintOverlayToken(input: { sceneId: string; label?: string }) {
    const [result, overlayPublicUrl] = await Promise.all([
      this.db.mintOverlayToken({
        sceneId: input.sceneId,
        applicationId: this.applicationId ?? "",
        label: input.label ?? "",
      }),
      resolveOverlayPublicUrl(this.db, this.overlayPublicUrl),
    ]);
    return toMintedResult(overlayPublicUrl, result.overlayToken);
  },

  async revokeOverlayToken(input: { tokenId: string }): Promise<{ tokenId: string; status: string }> {
    const result = await this.db.revokeOverlayToken({ id: input.tokenId });
    return { tokenId: result.overlayToken.id, status: result.overlayToken.status };
  },

  async rotateOverlayToken(input: { tokenId: string; label?: string }) {
    const [result, overlayPublicUrl] = await Promise.all([
      this.db.rotateOverlayToken({ id: input.tokenId }),
      resolveOverlayPublicUrl(this.db, this.overlayPublicUrl),
    ]);
    return toMintedResult(overlayPublicUrl, result.overlayToken);
  },

  async listOverlayTokens(input?: { sceneId?: string; page?: number; pageSize?: number }) {
    const [result, overlayPublicUrl] = await Promise.all([
      this.db.listOverlayTokens({
        sceneId: input?.sceneId ?? "",
        applicationId: this.applicationId ?? "",
        includeRevoked: false,
      }),
      resolveOverlayPublicUrl(this.db, this.overlayPublicUrl),
    ]);
    return (result.overlayTokens ?? []).map((row) => ({
      tokenId: row.id,
      token: row.token,
      sceneId: row.sceneId,
      label: row.label,
      status: row.status,
      createdAt: timestampToIso(row.createdAt),
      url: buildOverlayUrl(overlayPublicUrl, row.token),
    }));
  },
};
