import type { SharedLogger } from "@woofx3/common/logging";
import { RpcTarget } from "capnweb";
import type { Api } from "./api";
import { ApiSession } from "./api-session";
import type { ClientAuth } from "./auth";
import type { DbClient } from "./db-client";
import type { WebhookClient } from "./webhook-client";

export class ApiGateway extends RpcTarget {
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
    callbackUrl?: string,
    callbackToken?: string
  ): Promise<{ clientId: string; clientSecret: string }> {
    this.logger.info("Registering client", { description, applicationId: this.applicationId });
    try {
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
      this.logger.info("Client registered", { clientId: resp.client.clientId, description });
      return {
        clientId: resp.client.clientId,
        clientSecret: resp.client.clientSecret,
      };
    } catch (err) {
      this.logger.error("registerClient failed", {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      throw err;
    }
  }

  async ping(): Promise<{ status: string }> {
    this.logger.info("ping called");
    return { status: "ok" };
  }
}
