import type {
  TwitchDeviceLoginStartResult,
  TwitchDeviceLoginState,
  TwitchDeviceLoginStateResult,
  TwitchDeviceLoginStatus,
} from "@woofx3/api";
import type { SharedLogger } from "@woofx3/common/logging";
import type { PublicClientToken, TwitchOAuthClient } from "@woofx3/twitch/oauth";
import { isScopeName, TWITCH_ENGINE_SCOPES } from "@woofx3/twitch/scopes";
import type { StoredPublicToken } from "./twitch-token-source";

/** RFC 8628: each `slow_down` adds five seconds to the polling interval. */
const SLOW_DOWN_STEP_MS = 5_000;

/** The longest wait between polls while Twitch cannot be reached. */
const MAX_RETRY_DELAY_MS = 60_000;

/** Schedules `run` after `delayMs` and returns a function that cancels it. */
export type Schedule = (run: () => void, delayMs: number) => () => void;

const scheduleWithTimer: Schedule = (run, delayMs) => {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
};

export interface TwitchDeviceLoginsOptions {
  /** The engine's public Twitch app (`WOOFX3_TWITCH_PUBLIC_CLIENT_ID`); null when it has none. */
  clientId: string | null;
  oauth: Pick<TwitchOAuthClient, "startDeviceAuthorization" | "pollDeviceToken" | "validate">;
  /** Stores the linked token the way `setTwitchToken` does. */
  storeToken: (token: StoredPublicToken) => Promise<void>;
  logger: SharedLogger;
  now?: () => number;
  schedule?: Schedule;
  newId?: () => string;
}

interface Login {
  id: string;
  deviceCode: string;
  scopes: readonly string[];
  expiresAtMs: number;
  intervalMs: number;
  status: TwitchDeviceLoginStatus;
  reason?: string;
  linked?: { userId: string; login: string };
  /** Consecutive polls Twitch could not answer, for the retry backoff. */
  unavailableStreak: number;
  cancelTimer: (() => void) | null;
  /** Aborts the poll in flight when the login is cancelled or replaced, or the engine stops. */
  abort: AbortController;
}

/**
 * The engine's Twitch device logins (Device Code Grant), polled by the engine
 * so a client only has to show the code.
 *
 * An engine has one Twitch link, so it runs at most one login: starting
 * another replaces it, and a login is remembered, with its outcome, only
 * until the next one starts. Every poll is a timer this class owns; a login
 * stops polling when it ends (linked, expired, denied, failed), is
 * cancelled or replaced, or `stop` is called at shutdown.
 */
export class TwitchDeviceLogins {
  private current: Login | null = null;
  private stopped = false;
  private readonly now: () => number;
  private readonly schedule: Schedule;
  private readonly newId: () => string;

  constructor(private readonly opts: TwitchDeviceLoginsOptions) {
    this.now = opts.now ?? (() => Date.now());
    this.schedule = opts.schedule ?? scheduleWithTimer;
    this.newId = opts.newId ?? (() => crypto.randomUUID());
  }

  async start(scopes?: string[]): Promise<TwitchDeviceLoginStartResult> {
    const clientId = this.opts.clientId;
    if (!clientId) {
      return {
        ok: false,
        code: "not_configured",
        error: "this engine has no public Twitch app: set WOOFX3_TWITCH_PUBLIC_CLIENT_ID",
      };
    }
    const requested = scopes ?? TWITCH_ENGINE_SCOPES;
    if (!Array.isArray(requested) || requested.length === 0 || !requested.every(isScopeName)) {
      return { ok: false, code: "invalid_scopes", error: "scopes must be a non-empty list of Twitch scope names" };
    }
    if (this.stopped) {
      return { ok: false, code: "failed", error: "the engine is shutting down" };
    }

    let authorization: Awaited<ReturnType<TwitchDeviceLoginsOptions["oauth"]["startDeviceAuthorization"]>>;
    try {
      authorization = await this.opts.oauth.startDeviceAuthorization(clientId, requested);
    } catch (err) {
      return { ok: false, code: "failed", error: errorMessage(err) };
    }
    if (this.stopped) {
      return { ok: false, code: "failed", error: "the engine is shutting down" };
    }

    this.discardCurrent();
    const login: Login = {
      id: this.newId(),
      deviceCode: authorization.deviceCode,
      scopes: [...requested],
      expiresAtMs: this.now() + authorization.expiresInSeconds * 1000,
      intervalMs: authorization.intervalSeconds * 1000,
      status: "pending",
      unavailableStreak: 0,
      cancelTimer: null,
      abort: new AbortController(),
    };
    this.current = login;
    this.pollAfter(login, login.intervalMs);
    this.opts.logger.info("twitch device login started", { loginId: login.id });
    return {
      ok: true,
      login: {
        loginId: login.id,
        userCode: authorization.userCode,
        verificationUri: authorization.verificationUri,
        expiresAt: new Date(login.expiresAtMs).toISOString(),
      },
    };
  }

  get(loginId: string): TwitchDeviceLoginStateResult {
    const login = this.find(loginId);
    if (!login) {
      return { ok: false, code: "not_found", error: `no Twitch device login ${loginId}` };
    }
    return { ok: true, state: stateOf(login) };
  }

  cancel(loginId: string): { cancelled: boolean } {
    const login = this.find(loginId);
    if (!login) {
      return { cancelled: false };
    }
    const wasPending = login.status === "pending";
    this.discardCurrent();
    if (wasPending) {
      this.opts.logger.info("twitch device login cancelled", { loginId });
    }
    return { cancelled: wasPending };
  }

  /** Stop every poll for good. Called at shutdown. */
  stop(): void {
    this.stopped = true;
    this.discardCurrent();
  }

  private find(loginId: string): Login | null {
    return this.current?.id === loginId ? this.current : null;
  }

  private discardCurrent(): void {
    const login = this.current;
    if (!login) {
      return;
    }
    this.current = null;
    login.cancelTimer?.();
    login.cancelTimer = null;
    login.abort.abort();
    if (login.status === "pending") {
      // Ended here so a poll still in flight sees it is no longer wanted.
      login.status = "failed";
      login.reason = "cancelled";
    }
  }

  private pollAfter(login: Login, delayMs: number): void {
    login.cancelTimer = this.schedule(() => {
      login.cancelTimer = null;
      this.poll(login).catch((err) => {
        this.finish(login, "failed", `device login poll failed: ${errorMessage(err)}`);
      });
    }, delayMs);
  }

  private async poll(login: Login): Promise<void> {
    if (login.status !== "pending") {
      return;
    }
    if (this.now() >= login.expiresAtMs) {
      this.finish(login, "expired", "the code expired before Twitch was linked");
      return;
    }
    const clientId = this.opts.clientId;
    if (!clientId) {
      throw new Error("invariant: a device login runs only with a public client id");
    }
    const result = await this.opts.oauth.pollDeviceToken(clientId, login.deviceCode, login.scopes, login.abort.signal);
    if (login.status !== "pending") {
      return;
    }
    switch (result.kind) {
      case "pending":
        login.unavailableStreak = 0;
        login.reason = undefined;
        this.pollAfter(login, login.intervalMs);
        return;
      case "slowDown":
        login.intervalMs += SLOW_DOWN_STEP_MS;
        this.pollAfter(login, login.intervalMs);
        return;
      case "unavailable":
        login.unavailableStreak += 1;
        login.reason = result.reason;
        this.pollAfter(login, retryDelay(login.intervalMs, login.unavailableStreak));
        return;
      case "expired":
        this.finish(login, "expired", result.reason);
        return;
      case "denied":
        this.finish(login, "denied", result.reason);
        return;
      case "failed":
        this.finish(login, "failed", result.reason);
        return;
      case "token":
        await this.link(login, clientId, result.token);
        return;
    }
  }

  /** Validate the issued token, learn whose it is, and store it as the engine's Twitch link. */
  private async link(login: Login, clientId: string, token: PublicClientToken): Promise<void> {
    let validation: Awaited<ReturnType<TwitchDeviceLoginsOptions["oauth"]["validate"]>>;
    try {
      validation = await this.opts.oauth.validate(token.accessToken);
    } catch (err) {
      this.finish(login, "failed", `could not validate the token Twitch issued: ${errorMessage(err)}`);
      return;
    }
    if (validation.clientId !== clientId) {
      this.finish(login, "failed", "Twitch issued the token to a different app than the engine's public client");
      return;
    }
    if (login.status !== "pending") {
      return;
    }
    try {
      await this.opts.storeToken({ ...token, userId: validation.userId, publicClientId: clientId });
    } catch (err) {
      this.finish(login, "failed", `could not store the Twitch token: ${errorMessage(err)}`);
      return;
    }
    login.linked = { userId: validation.userId, login: validation.login };
    this.finish(login, "linked");
  }

  private finish(login: Login, status: Exclude<TwitchDeviceLoginStatus, "pending">, reason?: string): void {
    if (login.status !== "pending") {
      return;
    }
    login.cancelTimer?.();
    login.cancelTimer = null;
    login.status = status;
    login.reason = reason;
    if (status === "linked") {
      this.opts.logger.info("twitch device login linked", { loginId: login.id, twitchUserId: login.linked?.userId });
    } else {
      this.opts.logger.warn("twitch device login ended", { loginId: login.id, status, reason });
    }
  }
}

/** Exponential backoff from the polling interval, capped, with jitter so retries do not land in step. */
function retryDelay(intervalMs: number, streak: number): number {
  const backoff = Math.min(intervalMs * 2 ** streak, MAX_RETRY_DELAY_MS);
  return Math.max(intervalMs, Math.round(backoff * (0.75 + Math.random() * 0.25)));
}

function stateOf(login: Login): TwitchDeviceLoginState {
  return {
    loginId: login.id,
    status: login.status,
    ...(login.reason !== undefined ? { reason: login.reason } : {}),
    expiresAt: new Date(login.expiresAtMs).toISOString(),
    ...(login.linked ? { linked: login.linked } : {}),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
