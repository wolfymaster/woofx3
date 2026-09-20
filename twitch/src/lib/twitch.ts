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
