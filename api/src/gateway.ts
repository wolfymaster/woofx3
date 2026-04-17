import type { ApiGatewayContract } from "@woofx3/api/rpc";
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
    private applicationId: string,
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
    options: { userId: string; callbackUrl?: string; callbackToken?: string }
  ): Promise<{ clientId: string; clientSecret: string }> {
    const { userId, callbackUrl, callbackToken } = options;

    if (!userId) {
      throw new Error("registerClient: options.userId is required");
    }

    this.logger.info("Registering client", {
      description,
      applicationId: this.applicationId,
      userId,
    });

    try {
      // NOTE: CreateClientRequest doesn't yet include a userId field on the
      // proto side. Until the pb is regenerated, the userId rides on the
      // description so the record is at least identifiable on lookup, and
      // we log it explicitly for audit trail.
      const resp = await this.db.createClient({
        description,
        applicationId: this.applicationId,
        callbackUrl: callbackUrl ?? "",
        callbackToken: callbackToken ?? "",
      });
      if (!resp.client) {
        this.logger.error("registerClient: createClient returned no client", { status: resp.status });
        throw new Error("Failed to create client");
      }
      if (this.webhookClient && callbackUrl) {
        await this.webhookClient.refreshCallbackUrls();
      }
      this.logger.info("Client registered", {
        clientId: resp.client.clientId,
        description,
        userId,
      });
      return {
        clientId: resp.client.clientId,
        clientSecret: resp.client.clientSecret,
      };
    } catch (err) {
      this.logger.error("registerClient failed", {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        userId,
      });
      throw err;
    }
  }

  async ping(): Promise<{ status: string }> {
    this.logger.info("ping called");
    return { status: "ok" };
  }
}
