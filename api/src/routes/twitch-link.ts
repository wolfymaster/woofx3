import type { TwitchLinkInfo } from "@woofx3/api";
import { routeModule } from "./context";
import { requestHelix } from "./twitch";

/** Reading the linked Twitch account; its row is `TwitchTokenSource`'s, its profile `TwitchProfiles`'. */
export const twitchLinkRoutes = routeModule({
  /** The linked account without its tokens, with its Helix profile when Twitch can be asked. */
  async getTwitchLink(): Promise<TwitchLinkInfo | null> {
    const link = await this.twitchToken.link();
    if (!link) {
      return null;
    }
    const profile = await this.twitchProfiles.lookup(link.userId, () =>
      requestHelix(this.nats, this.logger, "getUsers", { id: link.userId })
    );
    return {
      userId: link.userId,
      login: profile?.login ?? null,
      displayName: profile?.displayName ?? null,
      profileImageUrl: profile?.profileImageUrl ?? null,
      scopes: link.scopes,
      expiresAt: link.expiresAt,
      authFailedAt: link.authFailedAt,
    };
  },
});
