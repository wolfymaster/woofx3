import { builtinCommands } from "../chat/builtins";
import { type DispatcherDb, dbProxyDispatcherDb } from "../chat/db-client";
import { CHAT_DISPATCHER_GRANTS, ChatDispatcher, type DispatcherCounters } from "../chat/dispatcher";
import { GatewayReplier, type ReplierCounters } from "../chat/replier";
import { TwitchApiClient } from "../chat/twitchapi-client";
import type { ChatConfig } from "../config/chat";
import type { DbProxyClientConfig } from "../services/db-proxy";
import { bounded } from "./bounded";
import { type Clock, errorMessage, type Logger, type RandomSource, type Timers } from "./deps";
import { type BusClient, ScopeCounters, ScopedBus, type SubscriptionLimits } from "./scoped-bus";

/** The scope name of the dispatcher's bus use, in refusals and log lines. */
export const CHAT_SCOPE = "chat";

export interface ChatServiceDeps {
  config: ChatConfig;
  dbProxy: DbProxyClientConfig;
  /** Replaces the db-proxy client; tests pass an in-memory fake. */
  db?: DispatcherDb;
  bus: BusClient;
  limits: SubscriptionLimits;
  /** How long stop waits for lines still being handled. */
  drainMs: number;
  clock: Clock;
  random: RandomSource;
  timers: Timers;
  logger: Logger;
}

/** What /health reports about chat commands. */
export interface ChatSnapshot extends DispatcherCounters {
  replies: ReplierCounters;
  bus: ReturnType<ScopeCounters["snapshot"]>;
}

/**
 * Runs the chat dispatcher inside the host: it gives the dispatcher its own
 * bus scope (the dispatcher's grants and nothing more), the db-proxy client
 * and the built-in commands. The host starts it once the platform gateway
 * answers and stops it before the adapters, so a command never runs against
 * a gateway that is going away.
 */
export class ChatService {
  private readonly counters = new ScopeCounters();
  private readonly scope: ScopedBus;
  private readonly replier: GatewayReplier;
  private readonly dispatcher: ChatDispatcher;

  constructor(private readonly deps: ChatServiceDeps) {
    this.scope = new ScopedBus({
      scope: CHAT_SCOPE,
      client: deps.bus,
      grants: CHAT_DISPATCHER_GRANTS,
      limits: deps.limits,
      logger: deps.logger.child({ scope: CHAT_SCOPE }),
      counters: this.counters,
      clock: deps.clock,
    });
    const db = deps.db ?? dbProxyDispatcherDb(deps.dbProxy);
    this.replier = new GatewayReplier({
      bus: this.scope,
      timeoutMs: deps.config.replyTimeoutMs,
      logger: deps.logger,
    });
    this.dispatcher = new ChatDispatcher({
      config: deps.config,
      db,
      bus: this.scope,
      builtins: builtinCommands({
        db,
        twitchApi: new TwitchApiClient({ bus: this.scope, timeoutMs: deps.config.twitchApi.timeoutMs }),
        random: deps.random,
        logger: deps.logger,
      }),
      clock: deps.clock,
      timers: deps.timers,
      logger: deps.logger,
      replier: this.replier,
    });
  }

  /** Throws when the first command listing fails; the scope is closed again so a retry starts clean. */
  async start(): Promise<void> {
    try {
      await this.dispatcher.start();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  /**
   * Stops reloading and reading lines at once, then waits at most `drainMs`
   * for lines still being handled. A handler waiting on a platform answers
   * when that wait ends, so the wait is bounded rather than tied to the
   * adapters, and the caller can stop them while this drains.
   */
  async stop(): Promise<void> {
    const [, closed] = await Promise.all([
      this.dispatcher.stop(),
      bounded(() => this.scope.closeAll(), this.deps.drainMs, this.deps.timers),
    ]);
    if (closed.kind === "timeout") {
      this.deps.logger.error("chat lines still being handled past the stop deadline; leaving them", {
        drainMs: this.deps.drainMs,
      });
    } else if (closed.kind === "failed") {
      this.deps.logger.error("closing the chat bus scope failed", { error: errorMessage(closed.error) });
    }
  }

  snapshot(): ChatSnapshot {
    return { ...this.dispatcher.snapshot(), replies: this.replier.snapshot(), bus: this.counters.snapshot() };
  }
}
