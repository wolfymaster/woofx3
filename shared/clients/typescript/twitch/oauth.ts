/**
 * Twitch's OAuth endpoints as the engine's own Twitch app uses them: the
 * Device Code Grant that links an account, refreshing the token it yields,
 * and validating a token to learn whose it is.
 *
 * The app is a Twitch *public* client, so nothing here takes or sends a
 * client secret: an engine runs on a machine its owner controls, and a
 * secret shipped with it would not stay one. Twitch makes a public client's
 * refresh tokens single-use, so every refresh returns a new one the caller
 * must store before the old one is lost.
 *
 * This file imports nothing so the api service can use it without pulling
 * in the Twitch client's dependencies.
 */

export const TWITCH_ID_BASE_URL = "https://id.twitch.tv";

export const DEVICE_CODE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

/** The default for `TwitchOAuthClientOptions.requestTimeoutMs`. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** What Twitch answers when a device login starts. */
export interface DeviceAuthorization {
  deviceCode: string;
  /** The code the streamer types at `verificationUri`. */
  userCode: string;
  verificationUri: string;
  expiresInSeconds: number;
  /** The fewest seconds to wait between polls. */
  intervalSeconds: number;
}

/** A user access token issued to the engine's public client. */
export interface PublicClientToken {
  accessToken: string;
  refreshToken: string;
  scope: string[];
  expiresIn: number;
  /** When the engine received the token, in epoch milliseconds. */
  obtainmentTimestamp: number;
}

/**
 * One poll of a device login.
 *
 * - `token`: the streamer approved; the token is issued.
 * - `pending`: the streamer has not finished yet.
 * - `slowDown`: polling too fast; wait longer between polls.
 * - `expired`: the device code is no longer valid; start again.
 * - `denied`: the streamer refused.
 * - `unavailable`: Twitch could not be reached or failed (a network error or
 *   a 5xx); the login may still succeed on a later poll.
 * - `failed`: Twitch refused the poll for any other reason.
 */
export type DevicePoll =
  | { kind: "token"; token: PublicClientToken }
  | { kind: "pending" }
  | { kind: "slowDown" }
  | { kind: "expired"; reason: string }
  | { kind: "denied"; reason: string }
  | { kind: "unavailable"; reason: string }
  | { kind: "failed"; reason: string };

/** Who a token belongs to, from `GET /oauth2/validate`. */
export interface TokenValidation {
  clientId: string;
  userId: string;
  login: string;
  scopes: string[];
  expiresIn: number;
}

/** Twitch refused or failed an OAuth request. */
export class TwitchOAuthError extends Error {
  constructor(
    message: string,
    /** The HTTP status, or null when no response arrived. */
    readonly status: number | null
  ) {
    super(message);
    this.name = "TwitchOAuthError";
  }

  /**
   * Twitch refused the request itself (a 4xx), as opposed to being
   * unreachable or failing. For a refresh it means the refresh token is no
   * longer good, and only linking Twitch again replaces it.
   */
  get refused(): boolean {
    return this.status !== null && this.status >= 400 && this.status < 500;
  }
}

export interface TwitchOAuthClientOptions {
  fetch?: Fetch;
  baseUrl?: string;
  now?: () => number;
  /**
   * How long a request to Twitch, its answer's body included, may take
   * before it is given up, so a hung connection cannot stall a poll loop.
   * `DEFAULT_REQUEST_TIMEOUT_MS` when absent.
   */
  requestTimeoutMs?: number;
}

export class TwitchOAuthClient {
  private readonly fetch: Fetch;
  private readonly baseUrl: string;
  private readonly now: () => number;
  private readonly requestTimeoutMs: number;

  constructor(opts: TwitchOAuthClientOptions = {}) {
    this.fetch = opts.fetch ?? ((input, init) => fetch(input, init));
    this.baseUrl = (opts.baseUrl ?? TWITCH_ID_BASE_URL).replace(/\/+$/, "");
    this.now = opts.now ?? (() => Date.now());
    this.requestTimeoutMs = opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (!Number.isFinite(this.requestTimeoutMs) || this.requestTimeoutMs <= 0) {
      throw new Error(`requestTimeoutMs must be a positive number of milliseconds, got ${this.requestTimeoutMs}`);
    }
  }

  /** `POST /oauth2/device`. Throws `TwitchOAuthError` when Twitch refuses or cannot be reached. */
  async startDeviceAuthorization(clientId: string, scopes: readonly string[]): Promise<DeviceAuthorization> {
    const { status, body } = await this.post("/oauth2/device", { client_id: clientId, scopes: scopes.join(" ") });
    if (status !== 200) {
      throw new TwitchOAuthError(`Twitch refused to start a device login: ${describeError(status, body)}`, status);
    }
    const { device_code, user_code, verification_uri, expires_in, interval } = body;
    if (
      typeof device_code !== "string" ||
      device_code === "" ||
      typeof user_code !== "string" ||
      user_code === "" ||
      typeof verification_uri !== "string" ||
      !isHttpsUrl(verification_uri) ||
      typeof expires_in !== "number" ||
      expires_in <= 0 ||
      typeof interval !== "number" ||
      interval <= 0
    ) {
      throw new TwitchOAuthError("Twitch's device login answer is malformed", status);
    }
    return {
      deviceCode: device_code,
      userCode: user_code,
      verificationUri: verification_uri,
      expiresInSeconds: expires_in,
      intervalSeconds: interval,
    };
  }

  /** `POST /oauth2/token` with the device code. Never throws: every outcome is a `DevicePoll`. */
  async pollDeviceToken(
    clientId: string,
    deviceCode: string,
    scopes: readonly string[],
    signal?: AbortSignal
  ): Promise<DevicePoll> {
    let response: { status: number; body: Record<string, unknown> };
    try {
      response = await this.post(
        "/oauth2/token",
        { client_id: clientId, device_code: deviceCode, grant_type: DEVICE_CODE_GRANT_TYPE, scopes: scopes.join(" ") },
        signal
      );
    } catch (err) {
      return { kind: "unavailable", reason: errorMessage(err) };
    }
    const { status, body } = response;
    if (status === 200) {
      const token = this.readToken(body);
      return token ? { kind: "token", token } : { kind: "failed", reason: "Twitch's token answer is malformed" };
    }
    if (status >= 500) {
      return { kind: "unavailable", reason: describeError(status, body) };
    }
    // Twitch puts the OAuth error code in `message`; RFC 8628 puts it in `error`.
    const code = errorCode(body);
    switch (code) {
      case "authorization_pending":
        return { kind: "pending" };
      case "slow_down":
        return { kind: "slowDown" };
      case "expired_token":
      // Twitch's answer for a device code it no longer knows, which after
      // its expiry is what a poll sees.
      case "invalid device code":
        return { kind: "expired", reason: describeError(status, body) };
      case "access_denied":
        return { kind: "denied", reason: describeError(status, body) };
      default:
        return { kind: "failed", reason: describeError(status, body) };
    }
  }

  /**
   * `POST /oauth2/token` with a refresh token, as a public client (no
   * secret). The answer carries a new refresh token; the one passed in is
   * spent. Throws `TwitchOAuthError`; `refused` is true when Twitch no longer
   * accepts the refresh token.
   */
  async refresh(clientId: string, refreshToken: string): Promise<PublicClientToken> {
    const { status, body } = await this.post("/oauth2/token", {
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    if (status !== 200) {
      throw new TwitchOAuthError(`Twitch refused the refresh: ${describeError(status, body)}`, status);
    }
    const token = this.readToken(body);
    if (!token) {
      throw new TwitchOAuthError("Twitch's refresh answer is malformed", status);
    }
    return token;
  }

  /** `GET /oauth2/validate`. Throws `TwitchOAuthError` when Twitch refuses the token or cannot be reached. */
  async validate(accessToken: string): Promise<TokenValidation> {
    const { status, body } = await this.send("/oauth2/validate", {
      method: "GET",
      headers: { Authorization: `OAuth ${accessToken}` },
    });
    if (status !== 200) {
      throw new TwitchOAuthError(`Twitch refused the token: ${describeError(status, body)}`, status);
    }
    const { client_id, user_id, login, scopes, expires_in } = body;
    if (
      typeof client_id !== "string" ||
      client_id === "" ||
      typeof user_id !== "string" ||
      user_id === "" ||
      typeof login !== "string" ||
      !isStringArray(scopes) ||
      typeof expires_in !== "number"
    ) {
      throw new TwitchOAuthError("Twitch's validate answer is malformed or names no user", status);
    }
    return { clientId: client_id, userId: user_id, login, scopes, expiresIn: expires_in };
  }

  private readToken(body: Record<string, unknown>): PublicClientToken | null {
    const { access_token, refresh_token, scope, expires_in } = body;
    if (
      typeof access_token !== "string" ||
      access_token === "" ||
      typeof refresh_token !== "string" ||
      refresh_token === "" ||
      typeof expires_in !== "number"
    ) {
      return null;
    }
    return {
      accessToken: access_token,
      refreshToken: refresh_token,
      scope: isStringArray(scope) ? scope : [],
      expiresIn: expires_in,
      obtainmentTimestamp: this.now(),
    };
  }

  private async post(
    path: string,
    form: Record<string, string>,
    signal?: AbortSignal
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    return this.send(
      path,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams(form).toString(),
      },
      signal
    );
  }

  /**
   * One request and its whole answer, under the request timeout. Failing to
   * send it or to read the answer's body throws a `TwitchOAuthError` with no
   * status: no answer was read, so it says nothing about what Twitch decided.
   */
  private async send(
    path: string,
    init: RequestInit,
    signal?: AbortSignal
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const timeout = AbortSignal.timeout(this.requestTimeoutMs);
    try {
      const response = await this.fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      return { status: response.status, body: await readJson(response) };
    } catch (err) {
      throw new TwitchOAuthError(`could not reach Twitch: ${errorMessage(err)}`, null);
    }
  }
}

/** The body as an object; {} when it is empty or not a JSON object. */
async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (text === "") {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    // A non-JSON error page carries nothing to read; the status says enough.
    return {};
  }
}

function errorCode(body: Record<string, unknown>): string {
  for (const field of ["message", "error"]) {
    const value = body[field];
    if (typeof value === "string" && value !== "") {
      return value.toLowerCase();
    }
  }
  return "";
}

function describeError(status: number, body: Record<string, unknown>): string {
  const code = errorCode(body);
  return code ? `${code} (HTTP ${status})` : `HTTP ${status}`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
