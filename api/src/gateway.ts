import { createHash, timingSafeEqual } from "node:crypto";
import { type ApiGatewayContract, REGISTRATION_REFUSED, type RegisterClientOptions } from "@woofx3/api/rpc";
import type { SharedLogger } from "@woofx3/common/logging";
import { RpcTarget } from "capnweb";
import type { Api } from "./api";
import { ApiSession } from "./api-session";
import type { ClientAuth } from "./auth";
import type { DbClient } from "./db-client";
import type { RegistrationPolicy } from "./registration";
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

  /**
   * Serialises `registerClient` in `first` mode, so two callers racing on an
   * engine with no client cannot both be admitted as the first.
   */
  private registrationQueue: Promise<unknown> = Promise.resolve();

  /**
   * @param registration Who may register (see registration.ts). A managed
   *   engine is publicly reachable before anyone has registered, so without
   *   a token the first caller to find it would own it.
   */
  constructor(
    private api: Api,
    private auth: ClientAuth,
    private db: DbClient,
    private logger: SharedLogger,
    private registration: RegistrationPolicy
  ) {
    super();
    if (registration.mode === "open") {
      logger.warn(
        "WOOFX3_REGISTRATION_TOKEN is not set: any caller that reaches this engine can register a client. Set it on any engine reachable from the internet."
      );
    }
    if (registration.mode === "first") {
      logger.info(
        registration.token === null
          ? "Registration is open until the first client registers, then closed"
          : "Registration is open until the first client registers, then requires the registration token"
      );
    }
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
    });
    return new ApiSession(this.api, clientId);
  }

  async registerClient(
    description: string,
    options: RegisterClientOptions
  ): Promise<{ clientId: string; clientSecret: string }> {
    if (this.registration.mode !== "first") {
      this.admit(options.registrationToken, this.registration.mode === "token");
      return this.createClient(description, options);
    }
    const registered = this.registrationQueue.then(async () => {
      this.admit(options.registrationToken, await this.hasRegisteredClient());
      return this.createClient(description, options);
    });
    this.registrationQueue = registered.catch(() => {});
    return registered;
  }

  /**
   * Whether a `first`-mode engine is past its first registration. Read from
   * the db each time rather than remembered, so it holds across restarts;
   * removing every client opens registration again.
   */
  private async hasRegisteredClient(): Promise<boolean> {
    const resp = await this.db.listClients();
    return resp.clients.length > 0;
  }

  private async createClient(
    description: string,
    options: RegisterClientOptions
  ): Promise<{ clientId: string; clientSecret: string }> {
    const { callbackUrl, callbackToken } = options;
    this.logger.info("Registering client", { description, mode: this.registration.mode });

    const resp = await this.db.createClient({
      description,
      callbackUrl: callbackUrl ?? "",
      callbackToken: callbackToken ?? "",
    });
    if (!resp.client) {
      throw new Error("Failed to create client");
    }

    if (this.webhookClient && callbackUrl) {
      await this.webhookClient.refreshCallbackUrls();
    }

    return {
      clientId: resp.client.clientId,
      clientSecret: resp.client.clientSecret,
    };
  }

  /**
   * Refuse unless the caller presented this engine's registration token,
   * when `tokenRequired`. Both sides are hashed first so the comparison takes
   * the same time whatever the presented token's length, and never
   * short-circuits.
   */
  private admit(presented: string | undefined, tokenRequired: boolean): void {
    if (!tokenRequired) {
      return;
    }
    const expected = this.registration.token;
    if (expected === null) {
      throw new RegistrationRefused("This engine already has a registered client and accepts no more.");
    }
    if (!presented) {
      throw new RegistrationRefused("This engine requires a registration token to register.");
    }
    const expectedDigest = createHash("sha256").update(expected).digest();
    const actualDigest = createHash("sha256").update(presented).digest();
    if (!timingSafeEqual(expectedDigest, actualDigest)) {
      throw new RegistrationRefused("The registration token does not match this engine's.");
    }
  }

  async ping(): Promise<{ status: string }> {
    this.logger.info("ping called");
    return { status: "ok" };
  }
}
