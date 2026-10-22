/**
 * Readers for the Helix bodies the engine's Twitch methods answer with
 * (`TwitchHelixResult.body`, see `./twitch-helix`). The engine forwards
 * Twitch's JSON unchanged, so these read exactly what a direct Helix call
 * returns, and a client reads either source with the same function.
 *
 * Each reader takes the parsed body as `unknown` and returns `null` when the
 * body is not the shape Helix documents for that call. An empty string is
 * read as absent, like a missing field. Inside a list, an entry missing a
 * field the result cannot do without is skipped; an optional field that is
 * missing, empty or of the wrong type reads as absent (`null` or
 * `undefined`). What a client says to a person about a failure is the
 * client's choice and is not decided here.
 */

/**
 * Twitch's reason from an error body (`{ error, status, message }`), or null
 * when the text is not such a body or its message is empty. `text` is
 * `TwitchHelixResult.body` for a `helix` failure, or a direct call's body text.
 */
export function helixErrorMessage(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON (a proxy's error page, an empty body): there is no Helix reason to read.
    return null;
  }
  const message = isRecord(parsed) ? parsed.message : undefined;
  return typeof message === "string" && message !== "" ? message : null;
}

/** `GET /helix/users`: the one user asked for. */
export interface HelixUser {
  userId: string;
  login: string;
  /** The display name, or the login when Twitch sent none. */
  displayName: string;
  profileImageUrl?: string;
  /** `partner`, `affiliate`, or "" for a regular broadcaster. */
  broadcasterType?: string;
}

/** The first user of a `GET /helix/users` body; null when there is none. */
export function parseHelixUser(body: unknown): HelixUser | null {
  const row = firstRow(body);
  if (!row) {
    return null;
  }
  const userId = text(row.id);
  const login = text(row.login);
  if (!userId || !login) {
    return null;
  }
  const profileImageUrl = text(row.profile_image_url);
  return {
    userId,
    login,
    displayName: text(row.display_name) ?? login,
    ...(profileImageUrl ? { profileImageUrl } : {}),
    ...(typeof row.broadcaster_type === "string" ? { broadcasterType: row.broadcaster_type } : {}),
  };
}

/** A category (Twitch's "game"). */
export interface HelixCategory {
  id: string;
  name: string;
  /** Twitch's box art URL template, with `{width}` and `{height}` still in it. */
  boxArtUrl?: string;
}

/** `GET /helix/channels`: what the broadcaster's channel is set to. */
export interface HelixChannelInformation {
  title: string;
  /** Null when no category is set. Carries no box art: this call does not return it. */
  category: HelixCategory | null;
  tags: string[];
}

/** The first channel of a `GET /helix/channels` body; null when there is none. */
export function parseHelixChannelInformation(body: unknown): HelixChannelInformation | null {
  const row = firstRow(body);
  if (!row) {
    return null;
  }
  const gameId = text(row.game_id);
  return {
    title: typeof row.title === "string" ? row.title : "",
    category: gameId ? { id: gameId, name: typeof row.game_name === "string" ? row.game_name : "" } : null,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string") : [],
  };
}

/** The categories of a `GET /helix/games` or `GET /helix/search/categories` body; null when it has no list. */
export function parseHelixCategories(body: unknown): HelixCategory[] | null {
  const rows = dataRows(body);
  if (!rows) {
    return null;
  }
  return rows.flatMap((row): HelixCategory[] => {
    const id = text(row.id);
    const name = text(row.name);
    if (!id || !name) {
      return [];
    }
    const boxArtUrl = text(row.box_art_url);
    return [{ id, name, ...(boxArtUrl ? { boxArtUrl } : {}) }];
  });
}

/** `POST /helix/streams/markers`: where the marker landed. */
export interface HelixStreamMarker {
  /** Seconds into the broadcast; null when Twitch did not say. */
  positionSeconds: number | null;
  createdAt: string | null;
}

/** The marker of a `POST /helix/streams/markers` body; null when there is none. */
export function parseHelixStreamMarker(body: unknown): HelixStreamMarker | null {
  const row = firstRow(body);
  if (!row) {
    return null;
  }
  return {
    positionSeconds: typeof row.position_seconds === "number" ? row.position_seconds : null,
    createdAt: text(row.created_at),
  };
}

/** `POST /helix/clips`: the clip, a draft until it is published from its edit page. */
export interface HelixClip {
  clipId: string;
  editUrl: string;
}

/** The clip of a `POST /helix/clips` body; null when there is none. */
export function parseHelixClip(body: unknown): HelixClip | null {
  const row = firstRow(body);
  const clipId = text(row?.id);
  const editUrl = text(row?.edit_url);
  return clipId && editUrl ? { clipId, editUrl } : null;
}

/**
 * `POST /helix/chat/messages`. Twitch answers 200 even when it drops the
 * message (AutoMod, a duplicate, a blocked term), so whether it was sent is
 * read from the body's `is_sent`. A sent message is reported as sent even
 * when Twitch gave no id for it: calling it dropped would invite a resend,
 * and chat would get it twice. `dropReason` is Twitch's sentence, or null
 * when it gave none.
 */
export type HelixChatMessageResult =
  | { sent: true; messageId: string | null }
  | { sent: false; dropReason: string | null };

/** The outcome in a `POST /helix/chat/messages` body. A body that does not say it was sent was not. */
export function parseHelixChatMessageResult(body: unknown): HelixChatMessageResult {
  const row = firstRow(body);
  if (row?.is_sent === true) {
    return { sent: true, messageId: text(row.message_id) };
  }
  const drop = row?.drop_reason;
  return { sent: false, dropReason: isRecord(drop) ? text(drop.message) : null };
}

/** One page of a paginated Helix list, and the cursor of the next page (null on the last). */
export interface HelixPage<T> {
  items: T[];
  cursor: string | null;
}

/** Someone in the broadcaster's chat. */
export interface HelixChatter {
  userId: string;
  login: string;
  displayName: string;
}

/** A page of a `GET /helix/chat/chatters` body; null when it has no list. */
export function parseHelixChattersPage(body: unknown): HelixPage<HelixChatter> | null {
  return parsePage(body, (row) => {
    const userId = text(row.user_id);
    const login = text(row.user_login);
    if (!userId || !login) {
      return null;
    }
    return { userId, login, displayName: text(row.user_name) ?? login };
  });
}

/** A term chat messages may not contain. */
export interface HelixBlockedTerm {
  id: string;
  text: string;
  createdAt: string | null;
  /** Null for a term that never expires. */
  expiresAt: string | null;
}

/**
 * A page of a `GET /helix/moderation/blocked_terms` body, or the term a
 * `POST` added (its only item); null when it has no list.
 */
export function parseHelixBlockedTermsPage(body: unknown): HelixPage<HelixBlockedTerm> | null {
  return parsePage(body, (row) => {
    const id = text(row.id);
    const term = text(row.text);
    if (!id || !term) {
      return null;
    }
    return { id, text: term, createdAt: text(row.created_at), expiresAt: text(row.expires_at) };
  });
}

/**
 * Every item of a paginated Helix list, reading at most `maxPages` pages.
 * `fetchPage` answers the body of the page after `cursor` (the first page for
 * `undefined`). `truncated` is true when pages remained after `maxPages`.
 * Throws when a page is unreadable: a list read half way would look complete.
 */
export async function collectHelixPages<T>(
  fetchPage: (cursor: string | undefined) => Promise<unknown>,
  parse: (body: unknown) => HelixPage<T> | null,
  maxPages: number
): Promise<{ items: T[]; truncated: boolean }> {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new Error(`collectHelixPages: maxPages must be a whole number of at least 1, not ${maxPages}`);
  }
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const parsed = parse(await fetchPage(cursor));
    if (!parsed) {
      throw new Error(`Twitch answered page ${page + 1} of a list with a body that is not a Helix list`);
    }
    items.push(...parsed.items);
    if (parsed.cursor === null) {
      return { items, truncated: false };
    }
    cursor = parsed.cursor;
  }
  return { items, truncated: true };
}

/** The chat modes of the broadcaster's chat. */
export interface HelixChatSettings {
  emoteMode: boolean;
  followerMode: boolean;
  /** Minutes an account must have followed; null while follower mode is off. */
  followerModeDuration: number | null;
  slowMode: boolean;
  /** Seconds between messages; null while slow mode is off. */
  slowModeWaitTime: number | null;
  subscriberMode: boolean;
}

/** The settings of a `GET` or `PATCH /helix/chat/settings` body; null when there are none. */
export function parseHelixChatSettings(body: unknown): HelixChatSettings | null {
  const row = firstRow(body);
  if (!row) {
    return null;
  }
  return {
    emoteMode: row.emote_mode === true,
    followerMode: row.follower_mode === true,
    followerModeDuration: typeof row.follower_mode_duration === "number" ? row.follower_mode_duration : null,
    slowMode: row.slow_mode === true,
    slowModeWaitTime: typeof row.slow_mode_wait_time === "number" ? row.slow_mode_wait_time : null,
    subscriberMode: row.subscriber_mode === true,
  };
}

/** The pinned chat message (Twitch beta). */
export interface HelixChatPin {
  messageId: string;
  /** The message's plain text; null when Twitch sent none. */
  text: string | null;
  /** Display name of whoever sent the pinned message, or their login. */
  senderName: string | null;
  /** When the message was pinned, as epoch milliseconds. */
  pinnedAtMs: number | null;
  /** When the pin expires; null when it lasts until the stream ends. */
  endsAt: string | null;
}

/** The current pin of a `GET /helix/chat/pins` body; null when nothing is pinned. */
export function parseHelixChatPin(body: unknown): HelixChatPin | null {
  const row = firstRow(body);
  const messageId = text(row?.message_id);
  if (!row || !messageId) {
    return null;
  }
  const startsAt = text(row.starts_at);
  const pinnedAtMs = startsAt === null ? Number.NaN : Date.parse(startsAt);
  return {
    messageId,
    text: isRecord(row.message) ? text(row.message.text) : null,
    senderName: text(row.sender_user_name) ?? text(row.sender_user_login),
    pinnedAtMs: Number.isFinite(pinnedAtMs) ? pinnedAtMs : null,
    endsAt: text(row.ends_at),
  };
}

/**
 * `GET /helix/channels/ads`: the broadcaster's ad schedule. Times are
 * ISO-8601, or null when Twitch reports none. Helix documents these times as
 * RFC3339 but has sent Unix seconds (a number or a numeric string), and 0 or
 * "" for none; `helixAdTime` reads every one of those forms.
 *
 * Read leniently: a time that cannot be read is null and a count that cannot
 * be read is 0, and the rest of the schedule is still returned, so one odd
 * field does not hide the others.
 */
export interface HelixAdSchedule {
  /** When the next scheduled mid-roll starts; null when none is scheduled. */
  nextAdAt: string | null;
  /** When the last ad break started. */
  lastAdAt: string | null;
  /** Length of the next scheduled ad break, in seconds. */
  durationSeconds: number;
  /** Preroll-free seconds left at the moment Twitch answered. */
  prerollFreeSeconds: number;
  /** Snoozes left to spend. */
  snoozeCount: number;
  /** When the next snooze is added back; null when the count is full. */
  snoozeRefreshAt: string | null;
  /** The reader's clock when Twitch answered (Helix sends none), the reference the other times are read against. */
  serverNow: string;
}

/** `POST /helix/channels/ads/schedule/snooze`: the schedule after spending a snooze, read like `HelixAdSchedule`. */
export interface HelixAdSnooze {
  snoozeCount: number;
  snoozeRefreshAt: string | null;
  nextAdAt: string | null;
  serverNow: string;
}

/**
 * An ad schedule time as ISO-8601, or null for none or for a value that
 * cannot be read: RFC3339 text, Unix seconds as a number or numeric text, and
 * 0 or "" for nothing scheduled.
 */
export function helixAdTime(raw: unknown): string | null {
  if (typeof raw === "number") {
    return epochSecondsToIso(raw);
  }
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return epochSecondsToIso(Number(trimmed));
  }
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * The schedule in a `GET /helix/channels/ads` body; null when the body has
 * no schedule at all. `serverNow` is the caller's clock at receipt.
 */
export function parseHelixAdSchedule(body: unknown, serverNow: string): HelixAdSchedule | null {
  const row = firstRow(body);
  if (!row) {
    return null;
  }
  return {
    nextAdAt: helixAdTime(row.next_ad_at),
    lastAdAt: helixAdTime(row.last_ad_at),
    durationSeconds: wholeCount(row.duration),
    prerollFreeSeconds: wholeCount(row.preroll_free_time),
    snoozeCount: wholeCount(row.snooze_count),
    snoozeRefreshAt: helixAdTime(row.snooze_refresh_at),
    serverNow,
  };
}

/** The result in a `POST /helix/channels/ads/schedule/snooze` body; null when it has none. */
export function parseHelixAdSnooze(body: unknown, serverNow: string): HelixAdSnooze | null {
  const row = firstRow(body);
  if (!row) {
    return null;
  }
  return {
    snoozeCount: wholeCount(row.snooze_count),
    snoozeRefreshAt: helixAdTime(row.snooze_refresh_at),
    nextAdAt: helixAdTime(row.next_ad_at),
    serverNow,
  };
}

function epochSecondsToIso(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return new Date(seconds * 1000).toISOString();
}

/** A whole, non-negative count from a number or numeric text; 0 for anything else. */
function wholeCount(raw: unknown): number {
  const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : 0;
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function parsePage<T>(body: unknown, item: (row: Record<string, unknown>) => T | null): HelixPage<T> | null {
  const rows = dataRows(body);
  if (!rows) {
    return null;
  }
  const pagination = isRecord(body) && isRecord(body.pagination) ? body.pagination : {};
  return {
    items: rows.flatMap((row) => {
      const parsed = item(row);
      return parsed === null ? [] : [parsed];
    }),
    cursor: text(pagination.cursor),
  };
}

/** A Helix body's `data` entries that are objects; null when the body has no `data` list. */
function dataRows(body: unknown): Record<string, unknown>[] | null {
  if (!isRecord(body) || !Array.isArray(body.data)) {
    return null;
  }
  return body.data.filter(isRecord);
}

function firstRow(body: unknown): Record<string, unknown> | null {
  if (!isRecord(body) || !Array.isArray(body.data)) {
    return null;
  }
  const row: unknown = body.data[0];
  return isRecord(row) ? row : null;
}

/** A non-empty string, or null. */
function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
