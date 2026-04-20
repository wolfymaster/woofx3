import type { ApiGatewayContract, RegisterClientOptions } from "@woofx3/api/rpc";
import type { SharedLogger } from "@woofx3/common/logging";
import { RpcTarget } from "capnweb";
import type { Api } from "./api";
import { ApiSession } from "./api-session";
import type { ClientAuth } from "./auth";
import type { DbClient } from "./db-client";
import type { WebhookClient } from "./webhook-client";

export class ApiGateway extends RpcTarget implements ApiGatewayContract {
  private webhookClient: WebhookClient | null = null;

  constructor(
    private api: Api,
    private auth: ClientAuth,
    private db: DbClient,
    private logger: SharedLogger
  ) {
    super();
  }

  setWebhookClient(client: WebhookClient): void {
    this.webhookClient = client;
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
    if (!userId) {
      throw new Error("registerClient: options.userId is required");
    }
    this.logger.info("Registering client", { description, userId });

    // userId at the RPC boundary maps to users.woofx3_ui_user_id on the engine side.
    const user = await this.db.findOrCreateByWoofx3UIUserId(userId);

    console.log("user", user);

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

    // api.setApplicationId cascades into the shared webhookClient; we only
    // need to explicitly refresh callback URLs when a new callback was registered.
    this.api.setApplicationId(app.id);
    if (this.webhookClient && callbackUrl) {
      await this.webhookClient.refreshCallbackUrls();
    }

    return {
      clientId: resp.client.clientId,
      clientSecret: resp.client.clientSecret,
      applicationId: app.id,
    };
  }

  async ping(): Promise<{ status: string }> {
    this.logger.info("ping called");
    return { status: "ok" };
  }
}
