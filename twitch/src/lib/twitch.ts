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
   *
   * Twurple's `getCustomRewards(broadcaster, onlyManageable=true)` calls
   * GET https://api.twitch.tv/helix/channel_points/custom_rewards under
   * the hood; `onlyManageable=true` filters to rewards this app owns,
   * which matches what UI authors expect when wiring up redeem-driven
   * triggers/actions.
   */
  async listChannelPointRewards(_args: unknown): Promise<ChannelPointRewardOption[]> {
    const rewards = await this.apiClient.channelPoints.getCustomRewards(this.broadcaster, true);
    return rewards.map((r) => ({
      value: r.id,
      label: r.title,
      cost: r.cost,
      prompt: r.prompt,
      isEnabled: r.isEnabled,
    }));
  }
}
