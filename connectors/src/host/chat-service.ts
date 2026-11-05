import { MODERATION_LIMITS } from "@woofx3/api/moderation-config";
import { builtinCommands } from "../chat/builtins";
import { type DispatcherDb, dbProxyDispatcherDb } from "../chat/db-client";
import { CHAT_DISPATCHER_GRANTS, ChatDispatcher, type DispatcherCounters } from "../chat/dispatcher";
import { GatewayReplier, type ReplierCounters } from "../chat/replier";
import { TwitchApiClient } from "../chat/twitchapi-client";
import type { ChatConfig } from "../config/chat";
import { ModerationConfigStore } from "../moderation/config-store";
import { MODERATION_TUNABLES } from "../moderation/defaults";
import { MODERATION_FILTERS } from "../moderation/filters";
import { MemoryChatterHistory } from "../moderation/history";
import { linkPermits, MemoryPermitStore } from "../moderation/permit-store";
import { filterRegistry } from "../moderation/registry";
import { MODERATION_GRANTS, ModerationService } from "../moderation/service";
import type { DbProxyClientConfig } from "../services/db-proxy";
import { bounded } from "./bounded";
import { type Clock, errorMessage, type Logger, type RandomSource, type Timers } from "./deps";
import type { LinkStore } from "./link-readers";
import { type BusClient, ScopeCounters, ScopedBus, type SubjectGrants, type SubscriptionLimits } from "./scoped-bus";

/** The scope name of the dispatcher's bus use, in refusals and log lines. */
export const CHAT_SCOPE = "chat";

export interface ChatServiceDeps {
  config: ChatConfig;
  dbProxy: DbProxyClientConfig;
  /** Replaces the db-proxy client; tests pass an in-memory fake. */
  db?: DispatcherDb;
  /** Where the moderation config setting is read. */
  settings: Pick<LinkStore, "getSetting">;
  bus: BusClient;
  limits: SubscriptionLimits;
  /** How long drain waits for lines still being handled. */
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

/** The chat scope's grants: the dispatcher's and moderation's, each subject once. */
export const CHAT_SCOPE_GRANTS: SubjectGrants = {
  publishes: [...new Set([...CHAT_DISPATCHER_GRANTS.publishes, ...MODERATION_GRANTS.publishes])],
  subscribes: [...new Set([...CHAT_DISPATCHER_GRANTS.subscribes, ...MODERATION_GRANTS.subscribes])],
  requests: [...new Set([...CHAT_DISPATCHER_GRANTS.requests, ...MODERATION_GRANTS.requests])],
};

/**
 * Runs the chat dispatcher inside the host: it gives the dispatcher its own
 * bus scope (the dispatcher's and moderation's grants and nothing more), the
 * db-proxy client and the built-in commands. Chat moderation watches the
 * same lines. The host starts it once the platform gateway
 * answers. It stops in two steps around the adapters: `drain` stops reading
 * lines and lets those in flight finish while the gateway and the adapters
 * still answer, and `close` ends the scope once they are gone.
 */
export class ChatService {
  private readonly counters = new ScopeCounters();
  private readonly scope: ScopedBus;
  private readonly replier: GatewayReplier;
  private readonly dispatcher: ChatDispatcher;
  private readonly moderationConfig: ModerationConfigStore;

  constructor(private readonly deps: ChatServiceDeps) {
    this.scope = new ScopedBus({
      scope: CHAT_SCOPE,
      client: deps.bus,
      grants: CHAT_SCOPE_GRANTS,
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
    const moderationLogger = deps.logger.child({ component: "moderation" });
    this.moderationConfig = new ModerationConfigStore({
      settings: deps.settings,
      bus: this.scope,
      logger: moderationLogger,
    });
    const permits = new MemoryPermitStore(MODERATION_TUNABLES.permitCapacity, deps.clock);
    this.dispatcher = new ChatDispatcher({
      config: deps.config,
      db,
      bus: this.scope,
      builtins: builtinCommands({
        db,
        twitchApi: new TwitchApiClient({ bus: this.scope, timeoutMs: deps.config.twitchApi.timeoutMs }),
        permits: linkPermits(this.moderationConfig, permits),
        random: deps.random,
        logger: deps.logger,
      }),
      clock: deps.clock,
      timers: deps.timers,
      logger: deps.logger,
      replier: this.replier,
    });
    const moderation = new ModerationService({
      config: this.moderationConfig,
      registry: filterRegistry(MODERATION_FILTERS),
      env: {
        clock: deps.clock,
        history: new MemoryChatterHistory(
          {
            chatters: MODERATION_TUNABLES.historyChatters,
            linesPerChatter: MODERATION_TUNABLES.historyLinesPerChatter,
            retainMs: MODERATION_LIMITS.maxRepetitionWindowSeconds * 1_000,
          },
          deps.clock
        ),
        permits,
      },
      bus: this.scope,
      clock: deps.clock,
      logger: moderationLogger,
      tunables: MODERATION_TUNABLES,
      gatewayTimeoutMs: deps.config.replyTimeoutMs,
    });
    this.dispatcher.watch((line) => moderation.handle(line).then(() => undefined));
  }

  /**
   * Throws when the first command listing fails. The service is then closed
   * for good; the caller builds a new Host to try again.
   */
  async start(): Promise<void> {
    try {
      await this.moderationConfig.start();
      await this.dispatcher.start();
    } catch (error) {
      await this.drain();
      await this.close();
      throw error;
    }
  }

  /**
   * Stops reloading and reading lines at once, then waits at most `drainMs`
   * for lines still being handled. The scope stays open meanwhile, so a line
   * can still publish, ask twitchapi and send its reply through a gateway
   * the caller keeps running until this returns.
   */
  async drain(): Promise<void> {
    const [, drained] = await Promise.all([
      this.dispatcher.stop(),
      bounded(() => this.scope.drainSubscriptions(), this.deps.drainMs, this.deps.timers),
    ]);
    if (drained.kind === "timeout") {
      this.deps.logger.error("chat lines still being handled past the stop deadline; leaving them", {
        drainMs: this.deps.drainMs,
      });
    } else if (drained.kind === "failed") {
      this.deps.logger.error("draining the chat bus scope failed", { error: errorMessage(drained.error) });
    }
  }

  /** Ends the scope: every later publish or request is refused. Call after drain. */
  async close(): Promise<void> {
    try {
      await this.scope.closeAll();
    } catch (error) {
      this.deps.logger.error("closing the chat bus scope failed", { error: errorMessage(error) });
    }
  }

  snapshot(): ChatSnapshot {
    return { ...this.dispatcher.snapshot(), replies: this.replier.snapshot(), bus: this.counters.snapshot() };
  }
}
