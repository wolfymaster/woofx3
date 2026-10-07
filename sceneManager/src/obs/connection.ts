// Keeps sceneManager connected to OBS for as long as it runs.
//
// OBS is routinely started after sceneManager, closed mid-session, or
// restarted, and every one of those used to leave sceneManager without
// OBS control until it was restarted itself. This retries in the
// background with capped, jittered exponential backoff, and hands each new
// session to `onConnected` so work that depends on the connection is redone.
//
// Logging follows state transitions only. OBS being closed for an evening
// is one line, not one line per retry.

import type { Logger } from "@woofx3/common/runtime";
import { EndpointRelayError } from "../endpoints/dialer";

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
 * - `stopped`: `stop()` was called; nothing more will happen.
 */
export type ObsConnectionState = "connecting" | "connected" | "retrying" | "stopped";

export interface ObsBackoff {
  initialMs: number;
  maxMs: number;
}

export const DEFAULT_OBS_BACKOFF: ObsBackoff = { initialMs: 1_000, maxMs: 30_000 };

export interface ObsConnectionOptions<TClient> {
  /** Open a session or throw. Must not retry on its own. */
  open: () => Promise<ObsSession<TClient>>;
  /**
   * Runs after every successful connect. `first` is true only for the first
   * session this process opens. A failure is logged and does not drop the
   * session.
   */
  onConnected?: (client: TClient, info: { first: boolean }) => Promise<void> | void;
  logger: Logger;
  backoff?: ObsBackoff;
  /** Source of jitter in [0, 1); injectable so tests are deterministic. */
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * The delay before retry number `attempt` (0-based): doubling from
 * `initialMs`, capped at `maxMs`, then jittered down by up to half so
 * that several processes retrying against one OBS do not stay in step.
 */
export function obsRetryDelay(attempt: number, backoff: ObsBackoff, random: number): number {
  const ceiling = Math.min(backoff.maxMs, backoff.initialMs * 2 ** Math.min(attempt, 30));
  return Math.round(ceiling / 2 + (ceiling / 2) * random);
}

/** obs-websocket v5 WebSocketCloseCode.AuthenticationFailed. */
const OBS_AUTHENTICATION_FAILED = 4009;

export type ObsFailureKind = "authentication" | "unreachable" | "relay";

/**
 * The endpoint dialer throws `EndpointRelayError` when OBS is routed through
 * the companion and the bridge could not be opened. A wrong or missing
 * password closes the socket with 4009, which obs-websocket-js surfaces as the
 * connect error's `code`. Everything else a streamer can act on is "OBS is not
 * running or not listening there".
 */
export function obsFailureKind(err: unknown): ObsFailureKind {
  if (err instanceof EndpointRelayError) {
    return "relay";
  }
  const code = typeof err === "object" && err !== null && "code" in err ? (err as { code: unknown }).code : undefined;
  return code === OBS_AUTHENTICATION_FAILED ? "authentication" : "unreachable";
}

export class ObsConnection<TClient> {
  private state: ObsConnectionState = "connecting";
  private session: ObsSession<TClient> | null = null;
  private timer: unknown = null;
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

  private readonly backoff: ObsBackoff;
  private readonly random: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly options: ObsConnectionOptions<TClient>) {
    this.backoff = options.backoff ?? DEFAULT_OBS_BACKOFF;
    if (this.backoff.initialMs <= 0 || this.backoff.maxMs < this.backoff.initialMs) {
      throw new Error("ObsConnection: backoff needs 0 < initialMs <= maxMs");
    }
    this.random = options.random ?? Math.random;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  /** Begin connecting. Returns immediately; the first attempt runs in the background. */
  start(): void {
    if (this.started) {
      throw new Error("ObsConnection: start() called twice");
    }
    this.started = true;
    void this.attempt();
  }

  /** Cancel any pending retry and close the open session. Final. */
  async stop(): Promise<void> {
    this.state = "stopped";
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    const session = this.session;
    this.session = null;
    this.generation += 1;
    if (session) {
      await session.close().catch(() => undefined);
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
    void session.close().catch(() => undefined);
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
      this.clearTimer(this.timer);
      this.timer = null;
    }
    const session = this.session;
    if (session) {
      this.generation += 1;
      this.session = null;
      void session.close().catch(() => undefined);
    }
    this.state = this.hasConnected ? "retrying" : "connecting";
    this.failures = 0;
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
      session = await this.options.open();
    } catch (err) {
      if (seq === this.attemptSeq) {
        this.onAttemptFailed(err);
      }
      return;
    }
    if (this.isStopped() || seq !== this.attemptSeq) {
      await session.close().catch(() => undefined);
      return;
    }
    this.onSessionOpened(session);
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
        .then(() => hook(session.client, { first }))
        .catch((err) => {
          logger.warn("OBS post-connect work failed", {
            error: err instanceof Error ? err.message : String(err),
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
    const error = err instanceof Error ? err.message : String(err);
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
    const delay = obsRetryDelay(this.failures, this.backoff, this.random());
    this.timer = this.setTimer(() => {
      void this.attempt();
    }, delay);
  }
}
