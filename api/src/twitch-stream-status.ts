import type { SharedLogger } from "@woofx3/common/logging";
import type { TwitchCredentials } from "./twitch-token-source";

export interface StreamStatus {
  isLive: boolean;
  uptime: string;
  viewerCount: number;
  startedAt?: string;
  streamTitle?: string;
  gameName?: string;
  twitchUserId?: string;
}

/**
 * Resolve the broadcaster's live stream state from Twitch Helix
 * `GET /helix/streams`, with the linked account's token (`TwitchCredentials`).
 *
 * A module rather than a route method because two callers need it: the
 * `getStreamStatus` RPC and the stream-online/offline NATS subscriptions.
 * It previously lived on the accounts route module and was reached through
 * `this` from subscriptions -- coupling with no import edge, invisible to
 * the module graph.
 *
 * Never throws. Any failure returns the offline shape, so a caller never
 * sees an exception merely because the stream is down or a token is
 * briefly stale; the polling cron retries a minute later.
 */
export async function getStreamStatus(twitch: TwitchCredentials, logger: SharedLogger): Promise<StreamStatus> {
  const offline = { isLive: false as const, uptime: "00:00:00", viewerCount: 0 };

  const credentials = await twitch.helix();
  if (typeof credentials === "string") {
    logger.debug("getStreamStatus: no Twitch credentials", { reason: credentials });
    return offline;
  }
  const token = { accessToken: credentials.accessToken, userId: credentials.broadcasterId };
  const clientId = credentials.clientId;

  let response: Response;
  try {
    response = await fetch(`https://api.twitch.tv/helix/streams?user_id=${encodeURIComponent(token.userId)}`, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Client-Id": clientId,
      },
    });
  } catch (err) {
    logger.warn("getStreamStatus: helix fetch failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return offline;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "unreadable");
    logger.warn("getStreamStatus: helix non-2xx", {
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
}
