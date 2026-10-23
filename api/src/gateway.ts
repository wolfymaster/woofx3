import type {
  CancelPairingRequest,
  CancelPairingResponse,
  ClaimPairingRequest,
  ClaimPairingResponse,
  StartPairingRequest,
  StartPairingResponse,
} from "@woofx3/api/pairing";
import {
  AUTHENTICATION_REFUSED,
  type GatewayPingResponse,
  authenticationRefusedMessage,
  REGISTRATION_REFUSED,
  type RegisterClientOptions,
  registrationRefusedMessage,
} from "@woofx3/api/rpc";
import { comparableOriginOf } from "@woofx3/common/http/request-guard";
import { secretsMatch } from "@woofx3/common/http/secrets";
import type { SharedLogger } from "@woofx3/common/logging";
import type { Api } from "./api";
import { ApiSession } from "./api-session";
import type { ClientAuth } from "./auth";
import type { ClientSessions } from "./client-sessions";
import type { DbClient } from "./db-client";
import type { ConnectionInfo } from "./gateway-connection";
import type { PairingRegistry } from "./pairing";
import type { RegistrationPolicy } from "./registration";
import type { WebhookClient } from "./webhook-client";

/**
 * A registration the engine will not accept. Its message carries the
 * REGISTRATION_REFUSED marker, so a capnweb client can tell the refusal from
 * a transient failure.
 */
export class RegistrationRefused extends Error {
  constructor(reason: string) {
    super(registrationRefusedMessage(reason));
    this.name = REGISTRATION_REFUSED;
  }
}

/**
 * Credentials the engine does not accept. Its message carries the
 * AUTHENTICATION_REFUSED marker, so a capnweb client can tell the refusal
 * from a transient failure and stop retrying.
 */
export class AuthenticationRefused extends Error {
  constructor(reason: string) {
    super(authenticationRefusedMessage(reason));
    this.name = AUTHENTICATION_REFUSED;
  }
}

/**
 * The unauthenticated gateway's behaviour, shared by every connection. It is
 * not served itself: capnweb serves a `GatewayConnection` per connection,
 * which calls in here with what it knows about that connection.
 */
/** Whether `connection` came from `boundOrigin`, a comparable origin. */
function fromOrigin(connection: ConnectionInfo, boundOrigin: string): boolean {
  return connection.origin !== null && comparableOriginOf(connection.origin) === boundOrigin;
}

export class ApiGateway {
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
   * @param pairing The engine's browser pairings, or null on an engine that
   *   does not pair (see `hostingOffersPairing`).
   */
  constructor(
    private api: Api,
    private auth: ClientAuth,
    private db: DbClient,
    private logger: SharedLogger,
    private registration: RegistrationPolicy,
    private sessions: ClientSessions,
    private pairing: PairingRegistry | null
  ) {
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

  /**
   * A session for `clientId`, registered so that deleting the client ends
   * it. A client deleted while its credentials were being checked is
   * refused, not admitted with a session that outlives it.
   *
   * A client a browser paired is bound to the origin it paired from: from
   * any other origin, or with none, its credentials are refused with the same
   * message as wrong ones, so the refusal says nothing about the secret.
   */
  async authenticate(clientId: string, clientSecret: string, connection: ConnectionInfo): Promise<ApiSession> {
    const generation = this.sessions.generation(clientId);
    const verdict = await this.auth.validate(clientId, clientSecret);
    if (verdict.kind === "refused") {
      throw new AuthenticationRefused("Invalid client credentials");
    }
    if (verdict.boundOrigin !== null && !fromOrigin(connection, verdict.boundOrigin)) {
      this.logger.warn("Refused a paired client from another origin", {
        clientId,
        origin: connection.origin,
        remoteAddress: connection.remoteAddress,
      });
      throw new AuthenticationRefused("Invalid client credentials");
    }
    const lease = this.sessions.register(clientId, generation, connection);
    if (lease === null) {
      this.logger.warn("Refused a client deleted while it authenticated", { clientId });
      throw new AuthenticationRefused("Invalid client credentials");
    }
    this.logger.info("Authenticated client", {
      clientId,
      description: verdict.description,
      origin: connection.origin,
      remoteAddress: connection.remoteAddress,
    });
    return new ApiSession(this.api, clientId, lease);
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
      kind: "CLIENT_KIND_REGISTERED",
      origin: "",
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
   * when `tokenRequired`.
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
    if (!secretsMatch(expected, presented)) {
      throw new RegistrationRefused("The registration token does not match this engine's.");
    }
  }

  async ping(): Promise<GatewayPingResponse> {
    this.logger.info("ping called");
    return this.pairing ? { status: "ok", pairing: "available" } : { status: "ok" };
  }

  /** Start pairing the browser `connection` came from; see pairing.ts. */
  async startPairing(request: StartPairingRequest, connection: ConnectionInfo): Promise<StartPairingResponse> {
    if (!this.pairing) {
      return { ok: false, code: "not_available", error: "this engine does not offer browser pairing" };
    }
    return this.pairing.start(request, connection.origin);
  }

  /** On an engine that does not pair no pairing exists, so every claim answers `not_found`. */
  async claimPairing(request: ClaimPairingRequest, connection: ConnectionInfo): Promise<ClaimPairingResponse> {
    if (!this.pairing) {
      return { status: "not_found" };
    }
    return this.pairing.claim(request, connection.origin);
  }

  async cancelPairing(request: CancelPairingRequest, connection: ConnectionInfo): Promise<CancelPairingResponse> {
    if (!this.pairing) {
      return { ok: false, code: "not_available" };
    }
    return this.pairing.cancel(request, connection.origin);
  }
}
