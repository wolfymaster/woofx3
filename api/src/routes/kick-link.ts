import type { KickLinkInfo } from "@woofx3/api";
import type { KickTokenGrant } from "@woofx3/api/webhooks";
import { KICKAPI_SUBJECT, kickApiResultType } from "@woofx3/common/cloudevents/Kick/commands";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import { routeModule } from "./context";

/** How long `getKickLink` waits for the Kick adapter to name the linked channel before answering without it. */
const KICK_SLUG_LOOKUP_TIMEOUT_MS = 3_000;

/** The linked user's channel slug from the Kick adapter, or null when it cannot say right now. */
async function linkedSlug(
  nats: Pick<NATSClient, "request">,
  logger: SharedLogger,
  userId: string
): Promise<string | null> {
  try {
    const reply = await nats.request(
      KICKAPI_SUBJECT,
      new TextEncoder().encode(JSON.stringify({ command: "getUser", args: { userId } })),
      { timeout: KICK_SLUG_LOOKUP_TIMEOUT_MS }
    );
    const event = JSON.parse(new TextDecoder().decode(reply.data)) as { type?: unknown; data?: { login?: unknown } };
    return event.type === kickApiResultType("getUser") && typeof event.data?.login === "string"
      ? event.data.login
      : null;
  } catch (err) {
    logger.debug("Could not look up the linked Kick channel's slug", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

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
      slug: this.nats === null ? null : await linkedSlug(this.nats, this.logger, account.userId),
      scopes: account.scopes,
      expiresAt: account.expiresAt,
      authFailedAt: account.authFailedAt,
    };
  },
});
