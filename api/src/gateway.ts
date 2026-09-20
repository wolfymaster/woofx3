import { createHash, timingSafeEqual } from "node:crypto";
import { type ApiGatewayContract, REGISTRATION_REFUSED, type RegisterClientOptions } from "@woofx3/api/rpc";
import type { SharedLogger } from "@woofx3/common/logging";
import { RpcTarget } from "capnweb";
import type { Api } from "./api";
import { ApiSession } from "./api-session";
import type { ApplicationScope } from "./application-scope";
import type { ClientAuth } from "./auth";
import type { DbClient } from "./db-client";
import type { WebhookClient } from "./webhook-client";

/**
 * A registration the engine will not accept. Named so the refusal is
 * recognisable across the capnweb boundary; see REGISTRATION_REFUSED.
 */
export class RegistrationRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = REGISTRATION_REFUSED;
  }
}

export class ApiGateway extends RpcTarget implements ApiGatewayContract {
  private webhookClient: WebhookClient | null = null;
  private applicationScope: ApplicationScope | null = null;

  /**
   * @param registrationToken The secret a caller must present to register
   *   (`WOOFX3_REGISTRATION_TOKEN`), or null to accept any caller. A
   *   managed engine is publicly reachable before anyone has registered,
   *   so without a token the first caller to find it would own it.
   */
  constructor(
    private api: Api,
    private auth: ClientAuth,
    private db: DbClient,
    private logger: SharedLogger,
    private registrationToken: string | null
  ) {
    super();
    if (registrationToken === null) {
      logger.warn(
        "WOOFX3_REGISTRATION_TOKEN is not set: any caller that reaches this engine can register a client. Set it on any engine reachable from the internet."
      );
    }
  }

  setWebhookClient(client: WebhookClient): void {
    this.webhookClient = client;
  }

  setApplicationScope(scope: ApplicationScope): void {
    this.applicationScope = scope;
  }

  async authenticate(clientId: string, clientSecret: string): Promise<ApiSession> {
    const result = await this.auth.validate(clientId, clientSecret);
    if (!result.valid) {
      throw new Error("Invalid client credentials");
    }
    this.logger.info("Authenticated client", {
      clientId,
      description: result.description,
      applicationId: result.applicationId,
    });
    return new ApiSession(this.api, clientId);
  }

  async registerClient(
    description: string,
    options: RegisterClientOptions
  ): Promise<{ clientId: string; clientSecret: string; applicationId: string }> {
    const { userId, callbackUrl, callbackToken } = options;
    this.requireRegistrationToken(options.registrationToken);
    if (!userId) {
      throw new Error("registerClient: options.userId is required");
    }
    this.logger.info("Registering client", { description, userId });

    // userId at the RPC boundary maps to users.woofx3_ui_user_id on the engine side.
    const user = await this.db.findOrCreateByWoofx3UIUserId(userId);

    let app = await this.db.getDefaultApplication();
    if (!app) {
      app = await this.db.createApplication({ name: "default", ownerId: user.id, isDefault: true });
      if (!app) {
        throw new Error("Failed to create default application");
      }
    }

    const resp = await this.db.createClient({
      description,
      applicationId: app.id,
      callbackUrl: callbackUrl ?? "",
      callbackToken: callbackToken ?? "",
    });
    if (!resp.client) {
      throw new Error("Failed to create client");
    }

    // Registration always resolves the default application, so after the
    // first client this writes the same id it already holds. Setting it only
    // on a change keeps the cascade into the webhook client -- and the
    // callback-url refresh behind it -- to the case that actually needs it:
    // the first registration, which is what creates the application.
    if (this.api.applicationIdOrNull() !== app.id) {
      this.api.setApplicationId(app.id);
    }
    if (this.webhookClient && callbackUrl) {
      await this.webhookClient.refreshCallbackUrls();
    }

    // After the client exists, so the Convex webhook client it starts can
    // read the callback this registration just stored. A failure here does
    // not fail the registration: the client is already created, and a
    // caller that retried would register a second one. The next
    // registration or a restart starts the components again.
    if (this.applicationScope) {
      try {
        await this.applicationScope.start(app.id);
      } catch (err) {
        this.logger.error("Application-scoped components failed to start after registration", {
          applicationId: app.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      clientId: resp.client.clientId,
      clientSecret: resp.client.clientSecret,
      applicationId: app.id,
    };
  }

  /**
   * Refuse unless the caller presented this engine's registration token.
   * Both sides are hashed first so the comparison takes the same time
   * whatever the presented token's length, and never short-circuits.
   */
  private requireRegistrationToken(presented: string | undefined): void {
    if (this.registrationToken === null) {
      return;
    }
    if (!presented) {
      throw new RegistrationRefused("This engine requires a registration token to register.");
    }
    const expected = createHash("sha256").update(this.registrationToken).digest();
    const actual = createHash("sha256").update(presented).digest();
    if (!timingSafeEqual(expected, actual)) {
      throw new RegistrationRefused("The registration token does not match this engine's.");
    }
  }

  async ping(): Promise<{ status: string }> {
    this.logger.info("ping called");
    return { status: "ok" };
  }
}
