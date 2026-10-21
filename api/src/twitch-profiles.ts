import type { TwitchHelixResult } from "@woofx3/api";
import type { SharedLogger } from "@woofx3/common/logging";

/** How long a looked-up profile is served before Twitch is asked again, so a renamed account catches up. */
export const DEFAULT_TWITCH_PROFILE_TTL_MS = 60 * 60_000;

/** A Twitch account's public profile, from Helix `GET /helix/users`. */
export interface TwitchProfile {
  userId: string;
  login: string;
  displayName: string;
  profileImageUrl: string | null;
}

export interface TwitchProfilesOptions {
  logger: SharedLogger;
  ttlMs?: number;
  now?: () => number;
}

/**
 * The linked account's profile, looked up through Helix and kept for a while.
 *
 * An engine has one Twitch link, so this holds one profile. A failed lookup
 * is not kept: the next read asks Twitch again.
 */
export class TwitchProfiles {
  private cached: { profile: TwitchProfile; fetchedAt: number } | null = null;
  private readonly logger: SharedLogger;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: TwitchProfilesOptions) {
    this.logger = opts.logger;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TWITCH_PROFILE_TTL_MS;
    this.now = opts.now ?? (() => Date.now());
    if (!(this.ttlMs > 0)) {
      throw new Error(`TwitchProfiles ttlMs must be positive, got ${this.ttlMs}`);
    }
  }

  /**
   * The profile of `userId`, from the cache or from `getUsers` (Helix
   * `GET /helix/users?id=<userId>`). Null when Twitch could not be asked or
   * did not describe that user; the reason is logged.
   */
  async lookup(userId: string, getUsers: () => Promise<TwitchHelixResult>): Promise<TwitchProfile | null> {
    const cached = this.cached;
    if (cached && cached.profile.userId === userId && this.now() - cached.fetchedAt < this.ttlMs) {
      return cached.profile;
    }
    const result = await getUsers();
    if (!result.ok) {
      this.logger.warn("could not look up the linked Twitch account's profile", {
        twitchUserId: userId,
        code: result.code,
        error: result.error,
      });
      return null;
    }
    const profile = readHelixUser(result.body, userId);
    if (!profile) {
      this.logger.warn("Twitch did not describe the linked Twitch account", { twitchUserId: userId });
      return null;
    }
    this.cached = { profile, fetchedAt: this.now() };
    return profile;
  }
}

/** The user `userId` from a Helix `GET /helix/users` body, or null when the body does not describe it. */
export function readHelixUser(body: unknown, userId: string): TwitchProfile | null {
  const data = typeof body === "object" && body !== null ? (body as { data?: unknown }).data : undefined;
  if (!Array.isArray(data)) {
    return null;
  }
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const { id, login, display_name, profile_image_url } = entry as Record<string, unknown>;
    if (id !== userId || typeof login !== "string" || login === "") {
      continue;
    }
    return {
      userId,
      login,
      displayName: typeof display_name === "string" && display_name !== "" ? display_name : login,
      profileImageUrl: typeof profile_image_url === "string" && profile_image_url !== "" ? profile_image_url : null,
    };
  }
  return null;
}
