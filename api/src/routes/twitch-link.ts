import type { TwitchLinkInfo } from "@woofx3/api";
import { routeModule } from "./context";
import { requestHelix } from "./twitch";

/** Reading the linked Twitch account; its row is `TwitchTokenSource`'s, its profile `TwitchProfiles`'. */
export const twitchLinkRoutes = routeModule({
  /** The linked account without its tokens, with its Helix profile when Twitch can be asked. */
  async getTwitchLink(): Promise<TwitchLinkInfo> {
    const { revision, account } = await this.twitchToken.link();
    if (!account) {
      return { linked: false, revision };
    }
    const profile = await this.twitchProfiles.lookup(account.userId, () =>
      requestHelix(this.nats, this.logger, "getUsers", { id: account.userId })
    );
    return {
      linked: true,
      revision,
      userId: account.userId,
      login: profile?.login ?? null,
      displayName: profile?.displayName ?? null,
      profileImageUrl: profile?.profileImageUrl ?? null,
      scopes: account.scopes,
      expiresAt: account.expiresAt,
      authFailedAt: account.authFailedAt,
    };
  },
});
