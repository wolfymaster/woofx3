import type { AccessTokenWithUserId, AuthProvider } from "@twurple/auth";

/**
 * A Twitch access token issued by a dashboard's Twitch app, with that app's
 * client id. It has no refresh token: the dashboard keeps it.
 */
export type DashboardToken = AccessTokenWithUserId & { clientId: string };

/**
 * Ask the dashboard for the linked account's token. `force` asks for a new one
 * even when the current one has not expired, because Twitch refused it.
 */
export type RequestDashboardToken = (force: boolean) => Promise<DashboardToken>;

type UserIdResolvable = Parameters<AuthProvider["getCurrentScopesForUser"]>[0];

/** A token this close to its expiry is replaced before use rather than after Twitch refuses it. */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * An auth provider for an engine whose Twitch token a dashboard owns.
 *
 * Refreshing a Twitch token takes the app's client secret, which a dashboard
 * never hands to an engine: a self-hosted engine is code its operator
 * controls. So where `RefreshingAuthProvider` refreshes, this one asks the
 * dashboard for a current token instead. It serves one account, the one that
 * linked Twitch, for every user and intent Twurple asks about.
 */
export class DashboardAuthProvider implements AuthProvider {
  private token: DashboardToken;
  private pending: Promise<DashboardToken> | null = null;

  constructor(
    initial: DashboardToken,
    private readonly request: RequestDashboardToken,
    private readonly now: () => number = () => Date.now()
  ) {
    this.token = initial;
  }

  get clientId(): string {
    return this.token.clientId;
  }

  get userId(): string {
    return this.token.userId;
  }

  /** Swap in a token the dashboard pushed, such as after the streamer relinks Twitch. */
  replace(token: DashboardToken): void {
    this.token = token;
  }

  getCurrentScopesForUser(user: UserIdResolvable): string[] {
    return this.isLinkedUser(user) ? this.token.scope : [];
  }

  async getAccessTokenForUser(user: UserIdResolvable): Promise<AccessTokenWithUserId | null> {
    if (!this.isLinkedUser(user)) {
      return null;
    }
    return this.current(false);
  }

  async getAccessTokenForIntent(): Promise<AccessTokenWithUserId | null> {
    return this.current(false);
  }

  async getAnyAccessToken(): Promise<AccessTokenWithUserId> {
    return this.current(false);
  }

  async refreshAccessTokenForUser(user: UserIdResolvable): Promise<AccessTokenWithUserId> {
    if (!this.isLinkedUser(user)) {
      throw new Error(`No Twitch token for user ${userIdOf(user)}: only the linked account has one`);
    }
    return this.current(true);
  }

  async refreshAccessTokenForIntent(): Promise<AccessTokenWithUserId> {
    return this.current(true);
  }

  private isLinkedUser(user: UserIdResolvable): boolean {
    return userIdOf(user) === this.token.userId;
  }

  private expiresSoon(): boolean {
    if (this.token.expiresIn === null) {
      return false;
    }
    return this.token.obtainmentTimestamp + this.token.expiresIn * 1000 - EXPIRY_MARGIN_MS <= this.now();
  }

  /**
   * The token to use now. Concurrent callers needing a new one share a single
   * request, so a burst of Helix calls at expiry asks the dashboard once.
   */
  private async current(force: boolean): Promise<DashboardToken> {
    if (!force && !this.expiresSoon()) {
      return this.token;
    }
    if (!this.pending) {
      this.pending = this.request(force)
        .then((token) => {
          this.token = token;
          return token;
        })
        .finally(() => {
          this.pending = null;
        });
    }
    return this.pending;
  }
}

function userIdOf(user: UserIdResolvable): string {
  if (typeof user === "string") {
    return user;
  }
  if (typeof user === "number") {
    return String(user);
  }
  return user.id;
}

/**
 * NATS subject the api service answers with the dashboard's token. Must match
 * `TWITCH_TOKEN_SUBJECT` in api/src/twitch-token-source.ts.
 */
export const TWITCH_TOKEN_SUBJECT = "engine.twitch.token";

type NatsRequest = (subject: string, data: Uint8Array, opts?: { timeout?: number }) => Promise<{ data: Uint8Array }>;

/**
 * A `RequestDashboardToken` that asks the api service, the engine's one
 * connection to its dashboard, so no other service holds the dashboard's
 * address or credentials.
 */
export function requestTokenOverNats(request: NatsRequest, timeoutMs = 15_000): RequestDashboardToken {
  return async (force) => {
    const reply = await request(TWITCH_TOKEN_SUBJECT, new TextEncoder().encode(JSON.stringify({ force })), {
      timeout: timeoutMs,
    });
    const body: unknown = JSON.parse(new TextDecoder().decode(reply.data));
    if (typeof body !== "object" || body === null) {
      throw new Error("the api service's token reply is not an object");
    }
    const { token, error } = body as { token?: unknown; error?: unknown };
    if (typeof error === "string") {
      throw new Error(`the api service could not get a Twitch token: ${error}`);
    }
    const dashboardToken = asReplyToken(token);
    if (!dashboardToken) {
      throw new Error("the api service's token reply is malformed");
    }
    return dashboardToken;
  };
}

function asReplyToken(value: unknown): DashboardToken | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { userId, accessToken, scope, expiresIn, obtainmentTimestamp, clientId } = value as Record<string, unknown>;
  if (
    typeof userId !== "string" ||
    typeof accessToken !== "string" ||
    typeof clientId !== "string" ||
    !Array.isArray(scope) ||
    !scope.every((s) => typeof s === "string") ||
    typeof expiresIn !== "number" ||
    typeof obtainmentTimestamp !== "number"
  ) {
    return null;
  }
  return { userId, accessToken, scope, expiresIn, obtainmentTimestamp, clientId, refreshToken: null };
}
