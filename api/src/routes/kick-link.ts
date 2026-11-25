import type { KickLinkInfo } from "@woofx3/api";
import type { KickTokenGrant } from "@woofx3/api/webhooks";
import { routeModule } from "./context";

/** Linking Kick; the token row is `KickTokenSource`'s. */
export const kickLinkRoutes = routeModule({
  /**
   * Store the linked Kick account's token. Only a dashboard can link Kick:
   * the token is renewed by asking the dashboard that sent it, named by the
   * session's client id. `convexUserId` scopes the row as `setTwitchToken`'s.
   */
  async setKickToken(
    token: KickTokenGrant,
    convexUserId?: string,
    context?: { clientId: string }
  ): Promise<{ ok: true }> {
    if (!context?.clientId) {
      throw new Error("A Kick token needs the session's client id to renew it");
    }
    let engineUserId: string | undefined;
    if (convexUserId) {
      engineUserId = (await this.db.findOrCreateByWoofx3UIUserId(convexUserId)).id;
    }
    await this.storeKickToken(token, context.clientId, engineUserId);
    this.logger.info("Kick token written to settings", {
      kickUserId: token.userId,
      engineUserId: engineUserId ?? "(unscoped)",
    });
    return { ok: true };
  },

  /** Forget the linked Kick account and turn the integration off. */
  async deleteKickToken(): Promise<{ ok: true }> {
    await this.kickToken.clear();
    this.logger.info("Kick token cleared from settings");
    await this.writeIntegrationEnabled("kick", false);
    await this.announceIntegrationChanged("kick", false);
    return { ok: true };
  },

  /** The linked account without its token. */
  async getKickLink(): Promise<KickLinkInfo> {
    const { revision, account } = await this.kickToken.link();
    if (account === null) {
      return { linked: false, revision };
    }
    return {
      linked: true,
      revision,
      userId: account.userId,
      slug: null,
      scopes: account.scopes,
      expiresAt: account.expiresAt,
      authFailedAt: account.authFailedAt,
    };
  },
});
