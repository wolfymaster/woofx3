// Keeps the OBS adapter connected to OBS for as long as it runs.
//
// OBS is routinely started after the engine, closed mid-session, or
// restarted, and none of those should leave the engine without OBS
// control until the adapter is restarted. This retries in the
// background with capped, jittered exponential backoff, and hands each new
// session to `onConnected` so work that depends on the connection is redone.
//
// Logging follows state transitions only. OBS being closed for an evening
// is one line, not one line per retry.

import { type Backoff, createBackoff } from "@woofx3/common/runtime";
import type { EndpointUnavailableReason } from "../../companion/types";
import type { ObsConnectionConfig } from "../../config/obs";
import { errorMessage, type Logger, type RandomSource, type TimerHandle, type Timers } from "../../host/deps";

/** One open OBS session: the client to issue requests on, and its lifecycle. */
export interface ObsSession<TClient> {
  client: TClient;
  /** Called at most once, when this session's socket closes for any reason. */
  onClose(listener: () => void): void;
  close(): Promise<void>;
}

/**
 * - `connecting`: first attempt in progress, never connected yet.
 * - `connected`: a session is open.
 * - `retrying`: not connected; another attempt is scheduled or running.
 * - `stopped`: `stop()` was called or the start signal aborted; nothing more will happen.
 */
export type ObsConnectionState = "connecting" | "connected" | "retrying" | "stopped";

export interface ObsConnectionOptions<TClient> {
  /** Open a session or throw. Must not retry on its own. */
  open: (signal: AbortSignal) => Promise<ObsSession<TClient>>;
  /**
   * Runs after every successful connect. A failure is logged and does not
   * drop the session.
   */
  onConnected?: (client: TClient) => Promise<void> | void;
  logger: Logger;
  /**
   * The retry backoff and `openTimeoutMs`: how long one attempt may take to
   * open a session. An OBS that accepts the socket but never completes the
   * Hello/Identify handshake would otherwise hold the attempt open forever,
   * with no retry ever scheduled.
   */
  config: Pick<ObsConnectionConfig, "backoff" | "openTimeoutMs">;
  /** Jitter for the backoff, so several engines retrying against one OBS do not stay in step. */
  random: RandomSource;
  timers: Timers;
}

/** obs-websocket v5 WebSocketCloseCode.AuthenticationFailed. */
const OBS_AUTHENTICATION_FAILED = 4009;

export type ObsFailureKind = "authentication" | "unreachable" | "relay";

/**
 * The companion gateway gave no route to OBS, or the bridge it gave could not
 * be opened. Carries the gateway's reason, and the bridge's host when the
 * attempt got that far.
 */
export class ObsRouteUnavailable extends Error {
  constructor(
    readonly reason: EndpointUnavailableReason,
    message: string,
    readonly address?: string
  ) {
    super(message);
    this.name = "ObsRouteUnavailable";
  }
}

/**
 * A bridge that could not be opened, or was too busy to try, reads as
 * `relay`. A wrong or missing password closes the socket with 4009, which
 * obs-websocket-js surfaces as the connect error's `code`. Everything else a
 * streamer can act on is "OBS is not running or not listening there".
 */
export function obsFailureKind(err: unknown): ObsFailureKind {
  if (err instanceof ObsRouteUnavailable) {
    return err.reason === "relay" || err.reason === "busy" ? "relay" : "unreachable";
  }
  const code = typeof err === "object" && err !== null && "code" in err ? (err as { code: unknown }).code : undefined;
  return code === OBS_AUTHENTICATION_FAILED ? "authentication" : "unreachable";
}

/** The attempt in flight when the connection stopped; it is never retried. */
class ObsConnectionStopped extends Error {
  constructor() {
    super("the OBS connection stopped");
    this.name = "ObsConnectionStopped";
  }
}

/** An attempt to open a session did not finish within its deadline. */
export class ObsOpenTimeout extends Error {
  constructor(readonly timeoutMs: number) {
    super(`OBS did not finish opening a session within ${timeoutMs}ms`);
    this.name = "ObsOpenTimeout";
  }
}

export class ObsConnection<TClient> {
  private state: ObsConnectionState = "connecting";
  private session: ObsSession<TClient> | null = null;
  private timer: TimerHandle | null = null;
  /** Failed attempts since the last session, for the log line that reports the next one. */
  private failures = 0;
  private hasConnected = false;
  private started = false;
  /** Bumped per session so a late close from an old socket is ignored. */
  private generation = 0;
  /** Why the last attempt failed; null until one has, and after a success. */
  private lastFailureKind: ObsFailureKind | null = null;
  /**
   * Bumped per attempt, so an attempt overtaken by `reconnectNow` discards
   * whatever it opens rather than installing a session made with old details.
   */
  private attemptSeq = 0;
  /** Aborted by stop: ends the open deadline and the connect timer of an attempt in flight; handed to `options.open`. */
  private readonly lifetime = new AbortController();
  private stopOnAbort: (() => void) | null = null;

  private readonly backoff: Backoff;
  private readonly openTimeoutMs: number;
  private readonly timers: Timers;

  constructor(private readonly options: ObsConnectionOptions<TClient>) {
    this.backoff = createBackoff(options.config.backoff, options.random);
    this.openTimeoutMs = options.config.openTimeoutMs;
    if (!(Number.isInteger(this.openTimeoutMs) && this.openTimeoutMs > 0)) {
      throw new Error(`ObsConnection: openTimeoutMs must be a whole number above 0, got ${this.openTimeoutMs}`);
    }
    this.timers = options.timers;
  }

  /**
   * Begin connecting. Returns immediately; the first attempt runs in the
   * background. `signal` aborting stops the connection as `stop()` does, and
   * an already aborted signal means it never dials.
   */
  start(signal: AbortSignal): void {
    if (this.started) {
      throw new Error("ObsConnection: start() called twice");
    }
    this.started = true;
    if (signal.aborted) {
      void this.stop();
      return;
    }
    const onAbort = () => {
      void this.stop();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    this.stopOnAbort = () => signal.removeEventListener("abort", onAbort);
    void this.attempt();
  }

  /** Cancel any pending retry or attempt in flight and close the open session. Final. */
  async stop(): Promise<void> {
    this.state = "stopped";
    this.stopOnAbort?.();
    this.stopOnAbort = null;
    this.lifetime.abort();
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
    const session = this.session;
    this.session = null;
    this.generation += 1;
    if (session) {
      await this.closeDropped(session);
    }
  }

  /**
   * Abandon the open session and reconnect, for a session that is open but
   * no longer answering: a socket that never closes would otherwise hold
   * every request hostage until OBS itself is restarted.
   */
  recycle(reason: string): void {
    if (this.isStopped() || !this.session) {
      return;
    }
    const session = this.session;
    this.dropSession(`OBS session abandoned (${reason}); reconnecting in the background`);
    void this.closeDropped(session);
  }

  /**
   * Reconnect straight away, for a change to where OBS is or how to sign in
   * to it: an open session was made with the old details, and a scheduled
   * retry would wait out its backoff with them.
   */
  reconnectNow(reason: string): void {
    if (this.isStopped()) {
      return;
    }
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
    const session = this.session;
    if (session) {
      this.generation += 1;
      this.session = null;
      void this.closeDropped(session);
    }
    this.state = this.hasConnected ? "retrying" : "connecting";
    this.failures = 0;
    this.backoff.reset();
    this.lastFailureKind = null;
    this.options.logger.info(`${reason}; reconnecting to OBS`);
    void this.attempt();
  }

  /** The open session's client, or null while not connected. */
  current(): TClient | null {
    return this.session?.client ?? null;
  }

  status(): ObsConnectionState {
    return this.state;
  }

  /**
   * Why OBS cannot be reached, as last seen: `authentication` for a refused
   * password, `relay` for a companion bridge that could not be opened,
   * `unreachable` for nothing answering or a lost connection. Null
   * while connected and before any attempt has failed.
   */
  lastFailure(): ObsFailureKind | null {
    return this.state === "connected" ? null : this.lastFailureKind;
  }

  /**
   * Closes a session this connection no longer uses. A failure is only
   * logged: the session is already dropped, so nothing reads it again, and
   * the next attempt opens a fresh socket either way. Never rejects.
   */
  private async closeDropped(session: ObsSession<TClient>): Promise<void> {
    try {
      await session.close();
    } catch (err) {
      this.options.logger.debug("closing a dropped OBS session failed", { error: errorMessage(err) });
    }
  }

  // A method rather than an inline comparison: `stop()` can change the state
  // across an await, which the compiler's narrowing does not account for.
  private isStopped(): boolean {
    return this.state === "stopped";
  }

  private async attempt(): Promise<void> {
    this.timer = null;
    if (this.isStopped()) {
      return;
    }
    this.attemptSeq += 1;
    const seq = this.attemptSeq;
    let session: ObsSession<TClient>;
    try {
      session = await this.openWithinDeadline();
    } catch (err) {
      if (seq === this.attemptSeq) {
        this.onAttemptFailed(err);
      }
      return;
    }
    if (this.isStopped() || seq !== this.attemptSeq) {
      await this.closeDropped(session);
      return;
    }
    this.onSessionOpened(session);
  }

  /**
   * `options.open()`, failed with `ObsOpenTimeout` if it has not settled in
   * `openTimeoutMs`, or with `ObsConnectionStopped` as soon as the connection
   * stops. A session that arrives after either belongs to no attempt and is
   * closed as soon as it does.
   */
  private openWithinDeadline(): Promise<ObsSession<TClient>> {
    const { signal } = this.lifetime;
    const opening = this.options.open(signal);
    return new Promise<ObsSession<TClient>>((resolve, reject) => {
      let settled = false;
      const settle = () => {
        settled = true;
        this.timers.clearTimeout(deadline);
        signal.removeEventListener("abort", onStop);
      };
      const onStop = () => {
        if (!settled) {
          settle();
          reject(new ObsConnectionStopped());
        }
      };
      const deadline = this.timers.setTimeout(() => {
        if (!settled) {
          settle();
          reject(new ObsOpenTimeout(this.openTimeoutMs));
        }
      }, this.openTimeoutMs);
      signal.addEventListener("abort", onStop, { once: true });
      opening.then(
        (session) => {
          if (settled) {
            void this.closeDropped(session);
            return;
          }
          settle();
          resolve(session);
        },
        (err: unknown) => {
          if (!settled) {
            settle();
            reject(err);
          }
        }
      );
    });
  }

  private onSessionOpened(session: ObsSession<TClient>): void {
    const { logger } = this.options;
    this.generation += 1;
    const generation = this.generation;
    this.session = session;
    this.state = "connected";
    const first = !this.hasConnected;
    this.hasConnected = true;
    logger.info(first ? "Connected to OBS" : "Reconnected to OBS", { afterFailedAttempts: this.failures });
    this.failures = 0;
    this.backoff.reset();
    this.lastFailureKind = null;

    session.onClose(() => {
      if (generation !== this.generation || this.isStopped()) {
        return;
      }
      this.dropSession("OBS connection lost; reconnecting in the background");
    });

    const hook = this.options.onConnected;
    if (hook) {
      Promise.resolve()
        .then(() => hook(session.client))
        .catch((err) => {
          logger.warn("OBS post-connect work failed", {
            error: errorMessage(err),
          });
        });
    }
  }

  /** Forget the open session, whatever became of it, and schedule a reconnect. */
  private dropSession(message: string): void {
    this.generation += 1;
    this.session = null;
    this.state = "retrying";
    // The loss was just reported; failures that follow are the expected
    // "OBS is not back yet" and stay quiet unless their kind changes.
    this.lastFailureKind = "unreachable";
    this.options.logger.warn(message);
    this.schedule();
  }

  private onAttemptFailed(err: unknown): void {
    if (this.isStopped()) {
      return;
    }
    const error = errorMessage(err);
    const kind = obsFailureKind(err);
    // One line per change in why OBS cannot be reached, then quiet: an
    // evening with OBS closed is one line, but a wrong password after OBS
    // starts is a different problem and is said once too.
    if (kind !== this.lastFailureKind) {
      this.lastFailureKind = kind;
      if (kind === "authentication") {
        this.options.logger.warn(
          "OBS refused the connection: check the WebSocket password in the OBS module's settings (or WOOFX3_OBS_RPC_TOKEN without the module); retrying in the background",
          { error }
        );
      } else if (kind === "relay") {
        this.options.logger.warn(
          "OBS is routed through the companion, and the relay could not open the bridge (is the companion running?); retrying in the background",
          { error }
        );
      } else {
        this.options.logger.warn("OBS not reachable; retrying in the background", { error });
      }
    } else {
      this.options.logger.debug("OBS connect attempt failed", { error, failures: this.failures + 1 });
    }
    this.state = "retrying";
    this.schedule();
    this.failures += 1;
  }

  private schedule(): void {
    if (this.isStopped() || this.timer !== null) {
      return;
    }
    const delay = this.backoff.next();
    this.timer = this.timers.setTimeout(() => {
      void this.attempt();
    }, delay);
  }
}
