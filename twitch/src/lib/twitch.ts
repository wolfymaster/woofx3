import type { ApiClient, HelixUser } from "@twurple/api";
import type { CreateMarkerArgs, TimeoutArgs, UpdateStreamArgs } from "@woofx3/common/cloudevents/Twitch/commands";

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

/** Twitch's own limits on channel information, checked before any request is made. */
export const TITLE_MAX_LENGTH = 140;
export const MARKER_DESCRIPTION_MAX_LENGTH = 140;
export const TAGS_MAX_COUNT = 10;
export const TAG_MAX_LENGTH = 25;
/** Twitch rejects a timeout outside 1 second to 2 weeks. */
export const TIMEOUT_MAX_SECONDS = 1_209_600;
const SEARCH_CATEGORIES_MAX = 100;
const SEARCH_CATEGORIES_DEFAULT = 10;
/** How many search results are checked for an exact name match. */
const CATEGORY_RESOLVE_CANDIDATES = 25;

/** Twitch rejects a ban or timeout reason longer than this. */
export const TIMEOUT_REASON_MAX_LENGTH = 500;

/**
 * Twitch tags are letters and digits only, in any script. Combining marks
 * are part of a letter in scripts such as Devanagari and Thai, so a tag
 * written in one would otherwise be refused.
 */
const TAG_PATTERN = /^[\p{L}\p{M}\p{N}]+$/u;

/**
 * Length as Twitch counts it, in characters rather than UTF-16 units, so an
 * emoji in a title counts once.
 */
function characterCount(text: string): number {
  return [...text].length;
}

export interface TimeoutResult {
  ok: true;
  userId: string;
  durationSeconds: number;
}

export interface UpdateStreamResult {
  ok: true;
  title?: string;
  categoryId?: string;
  /** Present when the category was resolved from free text. */
  categoryName?: string;
  tags?: string[];
}

export interface StreamMarkerResult {
  id: string;
  createdAt: string;
  description: string;
  positionSeconds: number;
}

export interface SearchCategoriesArgs {
  query: string;
  first?: number;
}

export interface TwitchCategory {
  id: string;
  name: string;
  boxArtUrl: string;
}

export interface StreamInfo {
  title: string;
  categoryId: string;
  categoryName: string;
  tags: string[];
  language: string;
}

export interface GetUserArgs {
  userId?: string;
  /** Login name, used when `userId` is absent. */
  userName?: string;
}

/**
 * A Twitch user and their channel. The category is the channel's current
 * one, which Twitch keeps after the stream ends, so it is what they were last
 * streaming. `stream` is null while they are offline.
 */
export interface TwitchUserInfo {
  userId: string;
  login: string;
  displayName: string;
  description: string;
  profileImageUrl: string;
  /** "partner", "affiliate" or "" for neither. */
  broadcasterType: string;
  /** When the account was created, ISO 8601. */
  createdAt: string;
  title: string;
  categoryId: string;
  categoryName: string;
  tags: string[];
  language: string;
  isLive: boolean;
  stream: { title: string; categoryName: string; viewerCount: number; startedAt: string } | null;
}

/** Throws unless `title` is a title Twitch will accept. */
export function validateTitle(title: unknown): string {
  if (typeof title !== "string") {
    throw new Error("updateStream: title must be a string");
  }
  const trimmed = title.trim();
  if (!trimmed) {
    throw new Error("updateStream: title cannot be empty");
  }
  const length = characterCount(trimmed);
  if (length > TITLE_MAX_LENGTH) {
    throw new Error(`updateStream: title is ${length} characters; Twitch allows at most ${TITLE_MAX_LENGTH}`);
  }
  return trimmed;
}

/** Throws unless `tags` is a tag list Twitch will accept. */
export function validateTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    throw new Error("updateStream: tags must be an array of strings");
  }
  if (tags.length > TAGS_MAX_COUNT) {
    throw new Error(`updateStream: ${tags.length} tags given; Twitch allows at most ${TAGS_MAX_COUNT}`);
  }
  const seen = new Set<string>();
  return tags.map((tag) => {
    if (typeof tag !== "string") {
      throw new Error("updateStream: tags must be an array of strings");
    }
    const trimmed = tag.trim();
    if (!trimmed) {
      throw new Error("updateStream: a tag cannot be empty");
    }
    if (characterCount(trimmed) > TAG_MAX_LENGTH) {
      throw new Error(`updateStream: tag "${trimmed}" is longer than ${TAG_MAX_LENGTH} characters`);
    }
    if (!TAG_PATTERN.test(trimmed)) {
      throw new Error(`updateStream: tag "${trimmed}" may only contain letters and numbers`);
    }
    // Twitch treats tags case-insensitively, so these would be one tag twice.
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`updateStream: tag "${trimmed}" is listed twice`);
    }
    seen.add(key);
    return trimmed;
  });
}

/**
 * The methods served on the `twitchapi` subject. Listed rather than read off
 * the class so a request can never reach a private helper or `constructor`.
 */
export const TWITCH_API_COMMANDS = [
  "clip",
  "listChannelPointRewards",
  "shoutout",
  "addChannelModerator",
  "timeout",
  "updateStream",
  "createMarker",
  "searchCategories",
  "getStreamInfo",
  "getUser",
  "getAdSchedule",
  "snoozeNextAd",
] as const satisfies readonly (keyof TwitchApi)[];

export type TwitchApiCommand = (typeof TWITCH_API_COMMANDS)[number];

export function isTwitchApiCommand(command: string): command is TwitchApiCommand {
  return (TWITCH_API_COMMANDS as readonly string[]).includes(command);
}

/**
 * A refusal a caller can act on without parsing the message: the dispatcher
 * sends `code` alongside the message in the `twitchapi.error` reply. Codes
 * are part of the `twitchapi` contract (docs/services/twitch-channel.md).
 */
export class TwitchApiError extends Error {
  constructor(
    readonly code: TwitchApiErrorCode,
    message: string
  ) {
    super(message);
    this.name = "TwitchApiError";
  }
}

/**
 * Why a Twitch call failed, in terms a caller can act on, so a caller can tell
 * "reconnect Twitch" from "wait and retry" without parsing messages. `failed`
 * is everything else; it stays in process and is never sent as a `code`.
 */
export type TwitchApiErrorCode = "missing_scope" | "unauthorized" | "rate_limited" | "failed";

/** The contract code a thrown error carries, if it is a TwitchApiError with an actionable code. */
export function twitchApiErrorCodeOf(err: unknown): Exclude<TwitchApiErrorCode, "failed"> | undefined {
  if (err instanceof TwitchApiError && err.code !== "failed") {
    return err.code;
  }
  return undefined;
}

/** Twurple's HttpStatusCodeError, matched by shape so this file needs no import of its package. */
function httpStatusOf(err: unknown): number | undefined {
  if (err && typeof err === "object" && "statusCode" in err && typeof err.statusCode === "number") {
    return err.statusCode;
  }
  return undefined;
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
  if (status !== undefined) {
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
   * 60 minutes) and answers a refusal with a 429. That refusal is routine on
   * a busy raid night, so it carries the `rate_limited` code: a workflow can
   * skip the shoutout instead of failing the run.
   */
  async shoutout(args: { userId?: string; userName?: string }): Promise<{ ok: true; userId: string }> {
    const target = await this.resolveUserId("shoutout", args);
    try {
      await this.apiClient.chat.shoutoutUser(this.broadcaster, target);
    } catch (err) {
      if (httpStatusOf(err) === 429) {
        throw new TwitchApiError(
          "rate_limited",
          "shoutout: Twitch allows one shoutout every 2 minutes, and one per channel every 60 minutes; try again later"
        );
      }
      throw err;
    }
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
   * Time a chatter out through Helix's ban endpoint, which is a timeout when
   * it carries a duration. Needs `moderator:manage:banned_users`.
   */
  async timeout(args: TimeoutArgs): Promise<TimeoutResult> {
    const durationSeconds = args?.durationSeconds;
    if (
      typeof durationSeconds !== "number" ||
      !Number.isInteger(durationSeconds) ||
      durationSeconds < 1 ||
      durationSeconds > TIMEOUT_MAX_SECONDS
    ) {
      throw new Error(`timeout: durationSeconds must be a whole number from 1 to ${TIMEOUT_MAX_SECONDS}`);
    }
    const userId = await this.resolveUserId("timeout", args);
    if (userId === this.broadcaster.id) {
      throw new Error("timeout: the broadcaster cannot be timed out");
    }
    if (args.reason !== undefined && typeof args.reason !== "string") {
      throw new Error("timeout: reason must be a string");
    }
    const reason = args.reason?.trim();
    if (reason && characterCount(reason) > TIMEOUT_REASON_MAX_LENGTH) {
      throw new Error(`timeout: reason is longer than ${TIMEOUT_REASON_MAX_LENGTH} characters`);
    }
    await this.apiClient.moderation.banUser(this.broadcaster, {
      user: userId,
      duration: durationSeconds,
      reason: reason || undefined,
    });
    return { ok: true, userId, durationSeconds };
  }

  /**
   * Change the channel's title, category and tags in one Helix update. Every
   * field is optional but at least one is required; each is validated
   * against Twitch's rules first, so a bad tag fails the whole update rather
   * than applying the title and dropping the rest. Needs
   * `channel:manage:broadcast`.
   */
  async updateStream(args: UpdateStreamArgs): Promise<UpdateStreamResult> {
    const input = args ?? {};
    if (input.category !== undefined && input.categoryId !== undefined) {
      throw new Error("updateStream: give category or categoryId, not both");
    }

    const result: UpdateStreamResult = { ok: true };
    if (input.title !== undefined) {
      result.title = validateTitle(input.title);
    }
    if (input.tags !== undefined) {
      result.tags = validateTags(input.tags);
    }
    if (input.categoryId !== undefined) {
      result.categoryId = String(input.categoryId).trim();
    }
    if (input.category !== undefined) {
      const category = await this.resolveCategory(String(input.category));
      result.categoryId = category.id;
      result.categoryName = category.name;
    }

    if (result.title === undefined && result.tags === undefined && result.categoryId === undefined) {
      throw new Error("updateStream: nothing to update; give a title, category, categoryId or tags");
    }

    await this.apiClient.channels.updateChannelInfo(this.broadcaster, {
      title: result.title,
      gameId: result.categoryId,
      tags: result.tags,
    });
    return result;
  }

  /**
   * Place a stream marker at the current point of the live broadcast. Twitch
   * only marks a live stream and answers 404 otherwise, which is turned into
   * an error a chatter or creator can act on. Needs `channel:manage:broadcast`.
   */
  async createMarker(args: CreateMarkerArgs): Promise<StreamMarkerResult> {
    const description = args?.description?.trim() ?? "";
    const length = characterCount(description);
    if (length > MARKER_DESCRIPTION_MAX_LENGTH) {
      throw new Error(
        `createMarker: description is ${length} characters; Twitch allows at most ${MARKER_DESCRIPTION_MAX_LENGTH}`
      );
    }
    let marker: Awaited<ReturnType<ApiClient["streams"]["createStreamMarker"]>>;
    try {
      marker = await this.apiClient.streams.createStreamMarker(this.broadcaster, description || undefined);
    } catch (err) {
      if (httpStatusOf(err) === 404) {
        throw new Error("createMarker: the channel is not live; Twitch only places markers on a live stream");
      }
      throw err;
    }
    return {
      id: marker.id,
      createdAt: marker.creationDate.toISOString(),
      description: marker.description,
      positionSeconds: marker.positionInSeconds,
    };
  }

  /** Categories matching `query`, in Twitch's relevance order. */
  async searchCategories(args: SearchCategoriesArgs): Promise<TwitchCategory[]> {
    const query = args?.query?.trim();
    if (!query) {
      throw new Error("searchCategories: query is required");
    }
    const first = args.first ?? SEARCH_CATEGORIES_DEFAULT;
    if (!Number.isInteger(first) || first < 1 || first > SEARCH_CATEGORIES_MAX) {
      throw new Error(`searchCategories: first must be a whole number from 1 to ${SEARCH_CATEGORIES_MAX}`);
    }
    const page = await this.apiClient.search.searchCategories(query, { limit: first });
    return page.data.map((game) => ({ id: game.id, name: game.name, boxArtUrl: game.boxArtUrl }));
  }

  /** The channel's current title, category and tags. */
  async getStreamInfo(_args: unknown): Promise<StreamInfo> {
    const channel = await this.apiClient.channels.getChannelInfoById(this.broadcaster);
    if (!channel) {
      throw new Error("getStreamInfo: Twitch returned no channel for the broadcaster");
    }
    return {
      title: channel.title,
      categoryId: channel.gameId,
      categoryName: channel.gameName,
      tags: channel.tags,
      language: channel.language,
    };
  }

  /** Who a user is, what their channel is set to, and whether they are live. Needs no scope. */
  async getUser(args: GetUserArgs): Promise<TwitchUserInfo> {
    const user = await this.resolveUser("getUser", args);
    const [channel, stream] = await Promise.all([
      this.apiClient.channels.getChannelInfoById(user.id),
      this.apiClient.streams.getStreamByUserId(user.id),
    ]);
    return {
      userId: user.id,
      login: user.name,
      displayName: user.displayName,
      description: user.description,
      profileImageUrl: user.profilePictureUrl,
      broadcasterType: user.broadcasterType,
      createdAt: user.creationDate.toISOString(),
      title: channel?.title ?? "",
      categoryId: channel?.gameId ?? "",
      categoryName: channel?.gameName ?? "",
      tags: channel?.tags ?? [],
      language: channel?.language ?? "",
      isLive: stream !== null,
      stream: stream
        ? {
            title: stream.title,
            categoryName: stream.gameName,
            viewerCount: stream.viewers,
            startedAt: stream.startDate.toISOString(),
          }
        : null,
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

  /**
   * The category a creator meant by `text`: the one whose name matches
   * exactly, ignoring case, else Twitch's most relevant result. Exact first
   * because search ranks by popularity, so "irl" alone can rank a game that
   * merely contains the letters above "IRL" itself.
   */
  private async resolveCategory(text: string): Promise<TwitchCategory> {
    const query = text.trim();
    if (!query) {
      throw new Error("updateStream: category cannot be empty");
    }
    const candidates = await this.searchCategories({ query, first: CATEGORY_RESOLVE_CANDIDATES });
    const wanted = query.toLowerCase();
    const match = candidates.find((c) => c.name.toLowerCase() === wanted) ?? candidates[0];
    if (!match) {
      throw new Error(`updateStream: no Twitch category matches "${query}"`);
    }
    return match;
  }

  /** The user named by whichever of id/name the caller had. */
  private async resolveUser(command: string, args: GetUserArgs): Promise<HelixUser> {
    const userId = args?.userId?.trim();
    const userName = args?.userName?.trim().replace(/^@/, "");
    if (!userId && !userName) {
      throw new Error(`${command}: userId or userName is required`);
    }
    const user = userId
      ? await this.apiClient.users.getUserById(userId)
      : await this.apiClient.users.getUserByName(userName as string);
    if (!user) {
      throw new Error(
        userId ? `${command}: no Twitch user with id ${userId}` : `${command}: no Twitch user named "${userName}"`
      );
    }
    return user;
  }

  /** A user id from whichever of id/name the caller had. */
  private async resolveUserId(command: string, args: { userId?: string; userName?: string }): Promise<string> {
    const userId = args?.userId?.trim();
    if (userId) {
      return userId;
    }
    const userName = args?.userName?.trim().replace(/^@/, "");
    if (!userName) {
      throw new Error(`${command}: userId or userName is required`);
    }
    const user = await this.apiClient.users.getUserByName(userName);
    if (!user) {
      throw new Error(`${command}: no Twitch user named "${userName}"`);
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
