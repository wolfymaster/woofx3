import type { ApiClient, HelixUser } from "@twurple/api";

/**
 * Each Twitch API method returns a plain data shape — the dispatcher in
 * application.ts wraps it into a CloudEvent reply for `msg.respond()`.
 * No more "publish a follow-up message on a different topic" pattern;
 * callers that issued the request via `nats.request()` get the data back
 * on the muxed inbox and decide what to do with it.
 */

export interface ClipResult {
  url: string;
  id: string;
}

export interface ChannelPointRewardOption {
  value: string; // reward id
  label: string; // reward title
  cost: number;
  prompt: string;
  isEnabled: boolean;
}

/**
 * The broadcaster's ad schedule. Times are ISO-8601, or null when Twitch has
 * none to report (no ad scheduled, or no ad run yet this stream).
 */
export interface AdSchedule {
  nextAdAt: string | null;
  lastAdAt: string | null;
  durationSeconds: number;
  prerollFreeSeconds: number;
  snoozeCount: number;
  snoozeRefreshAt: string | null;
  /** This service's clock when it answered, so a client can correct for skew. */
  serverNow: string;
}

export interface SnoozeResult {
  snoozeCount: number;
  snoozeRefreshAt: string | null;
  nextAdAt: string | null;
  serverNow: string;
}

/**
 * Why a Twitch call failed, in terms a caller can act on. Carried on the
 * dispatcher's error reply as `code`, so the api can tell "reconnect Twitch"
 * from "wait and retry" without parsing messages.
 */
export type TwitchApiErrorCode = "missing_scope" | "unauthorized" | "rate_limited" | "failed";

export class TwitchApiError extends Error {
  constructor(
    readonly code: TwitchApiErrorCode,
    message: string
  ) {
    super(message);
    this.name = "TwitchApiError";
  }
}

const AD_SCOPE_MESSAGE = "reconnect Twitch to allow ad controls";

/**
 * Twurple refuses a call its token lacks the scope for before sending it
 * ("does not have any of the requested scopes"); Twitch answers one it lets
 * through with a 401 naming the scope. Both mean the streamer has to relink.
 */
export function classifyTwitchError(err: unknown, context: string, scope: string): TwitchApiError {
  const message = err instanceof Error ? err.message : String(err);
  if (/requested scopes|missing scope/i.test(message)) {
    return new TwitchApiError("missing_scope", `${context}: Twitch has not granted ${scope}; ${AD_SCOPE_MESSAGE}`);
  }
  const status = httpStatusOf(err);
  if (status !== null) {
    if (status === 401 || status === 403) {
      if (/scope/i.test(message)) {
        return new TwitchApiError("missing_scope", `${context}: Twitch has not granted ${scope}; ${AD_SCOPE_MESSAGE}`);
      }
      return new TwitchApiError("unauthorized", `${context}: Twitch refused the token (HTTP ${status})`);
    }
    if (status === 429) {
      return new TwitchApiError("rate_limited", `${context}: Twitch rate limited the request`);
    }
  }
  return new TwitchApiError("failed", `${context}: ${message}`);
}

/**
 * Twurple's HttpStatusCodeError lives in @twurple/api-call, which this
 * service does not depend on directly, so the status is read by shape. Its
 * message includes the response body, which is where Twitch names a missing
 * scope.
 */
function httpStatusOf(err: unknown): number | null {
  if (typeof err === "object" && err !== null && "statusCode" in err) {
    const status = (err as { statusCode: unknown }).statusCode;
    if (typeof status === "number") {
      return status;
    }
  }
  return null;
}

type HelixTime = string | number | null | undefined;

interface HelixAdScheduleRow {
  next_ad_at?: HelixTime;
  last_ad_at?: HelixTime;
  duration?: number | string;
  preroll_free_time?: number | string;
  snooze_count?: number | string;
  snooze_refresh_at?: HelixTime;
}

interface HelixSnoozeRow {
  snooze_count?: number | string;
  snooze_refresh_at?: HelixTime;
  next_ad_at?: HelixTime;
}

/**
 * A Helix ad-schedule time as ISO-8601, or null for "none". Accepts every
 * form Helix has used: RFC3339, Unix seconds as a number or a numeric
 * string, and "" or 0 for nothing scheduled. An unreadable value is null
 * rather than an error: one odd field should not take the whole schedule
 * down with it.
 */
export function normalizeHelixTime(raw: HelixTime): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw === "number") {
    return epochSecondsToIso(raw);
  }
  const text = raw.trim();
  if (text === "") {
    return null;
  }
  if (/^\d+(\.\d+)?$/.test(text)) {
    return epochSecondsToIso(Number(text));
  }
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function epochSecondsToIso(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return new Date(seconds * 1000).toISOString();
}

function wholeSeconds(raw: number | string | undefined): number {
  const value = Number(raw ?? 0);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

export default class TwitchApi {
  constructor(
    private apiClient: ApiClient,
    private broadcaster: HelixUser
  ) {}

  async clip(_args: unknown): Promise<ClipResult> {
    const clipId = await this.apiClient.clips.createClip({
      channel: this.broadcaster,
    });
    return {
      id: clipId,
      url: `https://clips.twitch.tv/${clipId}`,
    };
  }

  /**
   * List the broadcaster's custom channel-point rewards. Powers the
   * UI's rewards dropdown — the shape mirrors `FieldOption` so the
   * default `useFieldOptions` transform doesn't need overriding.
   */
  async listChannelPointRewards(_args: unknown): Promise<ChannelPointRewardOption[]> {
    try {
      const rewards = await this.apiClient.channelPoints.getCustomRewards(this.broadcaster, false);
      return rewards.map((r) => ({
        value: r.id,
        label: r.title,
        cost: r.cost,
        prompt: r.prompt,
        isEnabled: r.isEnabled,
      }));
    } catch (err) {
      const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
      console.error(`[twitchapi] listChannelPointRewards: getCustomRewards threw — ${msg}`);
      throw err;
    }
  }

  /**
   * Shout out another broadcaster: Twitch's own shoutout, which shows the
   * channel to viewers, not a chat message about it.
   *
   * Accepts a user id or a login name, because a workflow author writing this
   * action has whichever the trigger gave them — a raid carries the raider's
   * id, a chat command carries what someone typed.
   *
   * Twitch rate-limits shoutouts (one every 2 minutes, and one per target per
   * 60 minutes) and answers a refusal with a 429, which surfaces through the
   * dispatcher's error path like any other failure.
   */
  async shoutout(args: { userId?: string; userName?: string }): Promise<{ ok: true; userId: string }> {
    const target = await this.resolveUserId(args);
    await this.apiClient.chat.shoutoutUser(this.broadcaster, target);
    return { ok: true, userId: target };
  }

  /**
   * Requires `channel:read:ads`. Called through `callApi` rather than
   * Twurple's `getAdSchedule` because Twurple converts the times assuming
   * Unix seconds, and Helix has sent them as RFC3339 strings, epoch numbers,
   * numeric strings and "" (nothing scheduled). The raw fields go through
   * `normalizeHelixTime` instead.
   */
  async getAdSchedule(_args: unknown): Promise<AdSchedule> {
    let row: HelixAdScheduleRow | undefined;
    try {
      const response = await this.apiClient.callApi<{ data?: HelixAdScheduleRow[] }>({
        type: "helix",
        url: "channels/ads",
        method: "GET",
        userId: this.broadcaster.id,
        scopes: ["channel:read:ads"],
        query: { broadcaster_id: this.broadcaster.id },
      });
      row = response.data?.[0];
    } catch (err) {
      throw classifyTwitchError(err, "getAdSchedule", "channel:read:ads");
    }
    return {
      nextAdAt: normalizeHelixTime(row?.next_ad_at),
      lastAdAt: normalizeHelixTime(row?.last_ad_at),
      durationSeconds: wholeSeconds(row?.duration),
      prerollFreeSeconds: wholeSeconds(row?.preroll_free_time),
      snoozeCount: wholeSeconds(row?.snooze_count),
      snoozeRefreshAt: normalizeHelixTime(row?.snooze_refresh_at),
      serverNow: new Date().toISOString(),
    };
  }

  /**
   * Push the next ad back by five minutes, spending one snooze. Twitch
   * answers a snooze with none left, or with no ad scheduled, with a 400,
   * which surfaces as a `failed` error carrying Twitch's message.
   * Requires `channel:manage:ads`.
   */
  async snoozeNextAd(_args: unknown): Promise<SnoozeResult> {
    let row: HelixSnoozeRow | undefined;
    try {
      const response = await this.apiClient.callApi<{ data?: HelixSnoozeRow[] }>({
        type: "helix",
        url: "channels/ads/schedule/snooze",
        method: "POST",
        userId: this.broadcaster.id,
        scopes: ["channel:manage:ads"],
        query: { broadcaster_id: this.broadcaster.id },
      });
      row = response.data?.[0];
    } catch (err) {
      throw classifyTwitchError(err, "snoozeNextAd", "channel:manage:ads");
    }
    return {
      snoozeCount: wholeSeconds(row?.snooze_count),
      snoozeRefreshAt: normalizeHelixTime(row?.snooze_refresh_at),
      nextAdAt: normalizeHelixTime(row?.next_ad_at),
      serverNow: new Date().toISOString(),
    };
  }

  /** A user id from whichever of id/name the caller had. */
  private async resolveUserId(args: { userId?: string; userName?: string }): Promise<string> {
    const userId = args?.userId?.trim();
    if (userId) {
      return userId;
    }
    const userName = args?.userName?.trim().replace(/^@/, "");
    if (!userName) {
      throw new Error("shoutout: userId or userName is required");
    }
    const user = await this.apiClient.users.getUserByName(userName);
    if (!user) {
      throw new Error(`shoutout: no Twitch user named "${userName}"`);
    }
    return user.id;
  }

  /**
   * Promote a user to channel moderator. Requires the broadcaster
   * token to carry the `channel:manage:moderators` scope; if absent,
   * Twurple will surface a 401 via the dispatcher's error path.
   */
  async addChannelModerator(args: { userId: string }): Promise<{ ok: true; userId: string }> {
    if (!args?.userId) {
      throw new Error("addChannelModerator: userId is required");
    }
    await this.apiClient.moderation.addModerator(this.broadcaster, args.userId);
    return { ok: true, userId: args.userId };
  }
}
