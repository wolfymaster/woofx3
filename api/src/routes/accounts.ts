export const accountsRoutes = {
  /**
   * Resolve the broadcaster's live stream state by calling Twitch
   * Helix `GET /helix/streams` with the OAuth token stored in the
   * `twitch_token` setting (same source `twitchBootstrap.ts` reads).
   *
   * `accountId` is accepted for backward compatibility with the legacy
   * mock signature but is currently unused — the engine is
   * single-broadcaster-per-deployment, so the bootstrapped Twitch user
   * is the only one to query. Per-application platform-link resolution
   * lands when the engine grows true multi-application support.
   *
   * Returns `{ isLive: false, uptime: "00:00:00", viewerCount: 0 }`
   * on any error so the UI never sees an exception just because the
   * stream is offline or the token is briefly stale — the polling
   * cron retries every minute.
   */
  async getStreamStatus(_accountId: string): Promise<{
    isLive: boolean;
    uptime: string;
    viewerCount: number;
    startedAt?: string;
    streamTitle?: string;
    gameName?: string;
    twitchUserId?: string;
  }> {
    const offline = { isLive: false as const, uptime: "00:00:00", viewerCount: 0 };

    const clientId = process.env.WOOFX3_TWITCH_CLIENT_ID;
    if (!clientId) {
      this.logger.warn("getStreamStatus: WOOFX3_TWITCH_CLIENT_ID not set");
      return offline;
    }

    let token: { accessToken?: string; userId?: string };
    try {
      const raw = await this.db.getSetting("twitch_token", "");
      if (!raw) {
        return offline;
      }
      token = JSON.parse(raw);
    } catch (err) {
      this.logger.warn("getStreamStatus: failed to read twitch_token", {
        error: err instanceof Error ? err.message : String(err),
      });
      return offline;
    }

    if (!token.accessToken || !token.userId) {
      return offline;
    }

    let response: Response;
    try {
      response = await fetch(`https://api.twitch.tv/helix/streams?user_id=${encodeURIComponent(token.userId)}`, {
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          "Client-Id": clientId,
        },
      });
    } catch (err) {
      this.logger.warn("getStreamStatus: helix fetch failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return offline;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "unreadable");
      this.logger.warn("getStreamStatus: helix non-2xx", {
        status: response.status,
        error: body,
      });
      return offline;
    }

    const body = (await response.json()) as { data?: Array<Record<string, unknown>> };
    const stream = body.data?.[0];
    if (!stream) {
      // Empty array == offline (Twitch Helix contract).
      return { ...offline, twitchUserId: token.userId };
    }

    const startedAt = typeof stream.started_at === "string" ? stream.started_at : new Date().toISOString();
    const startedAtMs = Date.parse(startedAt);
    const elapsedSec = Number.isFinite(startedAtMs) ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)) : 0;
    const hh = Math.floor(elapsedSec / 3600);
    const mm = Math.floor((elapsedSec % 3600) / 60);
    const ss = elapsedSec % 60;
    const uptime = [hh, mm, ss].map((n) => n.toString().padStart(2, "0")).join(":");

    return {
      isLive: true,
      uptime,
      viewerCount: typeof stream.viewer_count === "number" ? stream.viewer_count : 0,
      startedAt,
      streamTitle: typeof stream.title === "string" ? stream.title : undefined,
      gameName: typeof stream.game_name === "string" ? stream.game_name : undefined,
      twitchUserId: token.userId,
    };
  },
};
