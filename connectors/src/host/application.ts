import { lookup } from "node:dns/promises";
import type { IApplication } from "@woofx3/common/runtime";
import { dbProxyEndpointStore } from "../companion/endpoint-store";
import type { ConnectorsConfig } from "../config";
import { shutdownDeadlineProblem } from "../config/host";
import type DbProxyService from "../services/db-proxy";
import type MessageBusService from "../services/message-bus";
import { type AdapterRegistry, type LoadedAdapters, loadAdapters } from "./adapters";
import { dbProxyLinkStore } from "./db-link-store";
import { type Clock, errorMessage, type IdSource, type Logger, type RandomSource, type Timers } from "./deps";
import { type HealthServer, startHealthServer } from "./health";
import { Host } from "./host";
import type { LinkReaderRegistry } from "./link-readers";

export type ConnectorsServices = {
  messageBus: MessageBusService;
  dbProxy: DbProxyService;
};

export type ConnectorsContext = {
  services: ConnectorsServices;
};

export interface ConnectorsApplicationDeps {
  config: ConnectorsConfig;
  logger: Logger;
  adapters: AdapterRegistry;
  readers: LinkReaderRegistry;
  clock: Clock;
  random: RandomSource;
  ids: IdSource;
  timers: Timers;
}

/**
 * Adapts the host to the shared runtime. The runtime connects the bus and
 * db-proxy, then calls run; it may terminate and run again after a failed
 * health check, so every run builds a fresh host.
 */
export default class ConnectorsApplication implements IApplication<ConnectorsContext, ConnectorsServices> {
  readonly context: ConnectorsContext;
  private loaded: LoadedAdapters | undefined;
  private host: Host | undefined;
  private health: HealthServer | undefined;

  constructor(private readonly deps: ConnectorsApplicationDeps) {
    this.context = { services: {} } as ConnectorsContext;
  }

  /** Loads the adapter modules once per process. */
  async init(): Promise<void> {
    this.loaded ??= await loadAdapters(this.deps.adapters);
  }

  /**
   * Why the configured shutdown deadline cannot cover the loaded adapters'
   * served budgets, or undefined when it can. Needs init to have run.
   */
  shutdownDeadlineProblem(): string | undefined {
    if (this.loaded === undefined) {
      throw new Error("shutdownDeadlineProblem before init: the adapters are not loaded");
    }
    const { host, chat } = this.deps.config;
    const budgets = [...this.loaded.adapters.values()].flatMap((adapter) =>
      adapter.manifest.serves.map((served) => served.budgetMs)
    );
    return shutdownDeadlineProblem(host, chat.drainMs, budgets);
  }

  async run(ctx: ConnectorsContext): Promise<void> {
    if (this.loaded === undefined) {
      throw new Error("run before init: the adapters are not loaded");
    }
    const { messageBus, dbProxy } = ctx.services;
    const host = new Host({
      config: this.deps.config.host,
      gateway: this.deps.config.gateway,
      chat: this.deps.config.chat,
      companion: {
        config: this.deps.config.companion,
        store: dbProxyEndpointStore(dbProxy.client, this.deps.logger),
        fetch: (url, init) => fetch(url, init),
        resolver: async (name) => (await lookup(name, { all: true })).map((answer) => answer.address),
        openSocket: (url) => new WebSocket(url),
      },
      dbProxy: dbProxy.client,
      bus: messageBus.client,
      busConnected: () => messageBus.isUp(),
      linkStore: dbProxyLinkStore(dbProxy.client),
      adapters: this.loaded.adapters,
      hostStates: this.loaded.hostStates,
      readers: this.deps.readers,
      clock: this.deps.clock,
      random: this.deps.random,
      ids: this.deps.ids,
      timers: this.deps.timers,
      logger: this.deps.logger,
    });
    // A run the runtime retries after a failure must not leave the old host running beside the new one.
    await this.terminate();
    this.host = host;
    try {
      await host.start();
      if (this.host !== host || !host.isRunning) {
        // A terminate that ran while the host started has already let go of it; a
        // health server started now would have no one to stop it.
        this.deps.logger.info("connectors host stopped while starting");
        return;
      }
      this.health = startHealthServer(this.deps.config.host.port, () => host.snapshot());
    } catch (error) {
      if (this.host !== host) {
        // The terminate that stopped the host mid-start owns its shutdown, and may
        // already have handed this.host to a newer run, which must not be stopped.
        this.deps.logger.info("connectors host stopped while starting", { error: errorMessage(error) });
        return;
      }
      await this.terminate();
      throw error;
    }
    this.deps.logger.info("connectors host running", {
      adapters: [...this.loaded.adapters.keys()],
      healthPort: this.health.port,
    });
  }

  async terminate(): Promise<void> {
    const health = this.health;
    const host = this.host;
    this.health = undefined;
    this.host = undefined;
    await health?.stop();
    await host?.stop();
  }

  /** For the bus heartbeat: true from when a host finishes starting until it begins to stop. */
  isReady(): boolean {
    return this.host?.isRunning ?? false;
  }
}
