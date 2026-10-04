import type { ApplicationContext, IApplication, Application as RuntimeApplication } from "@woofx3/common/runtime";
import type { SceneManagerRuntimeConfig } from "./config";
import type DatabaseService from "./services/db";

export type SceneManagerServices = {
  db: DatabaseService;
};

export type SceneManagerContext = {
  runtimeConfig: SceneManagerRuntimeConfig;
};

type Context = ApplicationContext<SceneManagerContext, SceneManagerServices>;

export type SceneManagerApplication = RuntimeApplication<Context, SceneManagerServices>;

/**
 * sceneManager's application shell. `run(ctx)` starts the HTTP server
 * and blocks for the process lifetime — the shared runtime's
 * `applicationRunActor` treats a non-resolving promise as "running
 * normally" and only reacts if it rejects (see
 * `@woofx3/common/runtime/runtime.ts`).
 */
export default class SceneManager implements IApplication<SceneManagerContext, SceneManagerServices> {
  readonly context: SceneManagerContext;
  readonly __finalContextType!: SceneManagerContext;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private deliveryStore: import("./events/delivery-store").DeliveryStore | null = null;
  private obs: import("./obs/connection").ObsConnection<import("./obs/manager").default> | null = null;

  constructor(runtimeConfig: SceneManagerRuntimeConfig) {
    this.context = { runtimeConfig };
  }

  async run(ctx: Context): Promise<void> {
    const { createHttpServer } = await import("./http");
    const { OverlayTokenResolver } = await import("./scene/token-resolver");
    const { OverlayHost } = await import("./scene/scene-host");
    const { FrameAssembler, HttpBarkloaderFrameClient } = await import("./scene/frame-assembler");
    const { SessionTokenService } = await import("./scene/session-token");
    const { DeliveryStore } = await import("./events/delivery-store");
    const { ModuleStateWatch, linkedResources } = await import("./scene/module-state");
    const { PlacementVisibility } = await import("./scene/placement-visibility");
    const { createMessageBus } = await import("@woofx3/nats");
    const { openObsSession } = await import("./obs/manager");
    const { ObsConnection } = await import("./obs/connection");
    const { readObsConnectionConfig } = await import("./obs/settings");
    const { obsStatusReply } = await import("./obs/status");
    const { initSubscriptions } = await import("./nats-subscriptions");
    const { refreshOverlayBrowserSources } = await import("./obs/refresh-overlays");

    // Identity of this process, announced on every SSE stream so a
    // reconnecting overlay can tell a resumed stream from one that came
    // back against a restarted sceneManager (see routes/events.ts).
    const bootId = crypto.randomUUID();

    const db = ctx.services.db.client;
    const resolver = new OverlayTokenResolver(db, ctx.logger);
    const visibility = new PlacementVisibility();
    const host = new OverlayHost(resolver, db, ctx.logger, { visibility });
    const barkloader = new HttpBarkloaderFrameClient(ctx.runtimeConfig.barkloaderUrl, ctx.logger);
    const frameAssembler = new FrameAssembler(host, ctx.logger, {
      barkloader,
      linkedResources: (moduleId) => linkedResources(db, moduleId),
    });
    const sessionTokens = new SessionTokenService(ctx.runtimeConfig.tokenSecret);

    const deliveryStore = new DeliveryStore(db, ctx.logger);
    // Hydrate from the DB before accepting any traffic — a restart
    // must never silently drop in-flight events.
    await deliveryStore.hydrate();
    deliveryStore.startSweep();
    this.deliveryStore = deliveryStore;
    const moduleState = new ModuleStateWatch(db, deliveryStore, ctx.logger);

    // NATS and OBS are both best-effort, non-blocking dependencies —
    // scene serving must degrade gracefully without live
    // infrastructure (same philosophy streamware used), so neither
    // goes through the shared runtime's health-monitor-gated startup
    // (that would block core scene-serving on their availability).
    let nats: Awaited<ReturnType<typeof createMessageBus>> | null = null;
    try {
      nats = await createMessageBus(ctx.runtimeConfig.nats, ctx.logger);
      await nats.connect();
    } catch (err) {
      ctx.logger.warn("NATS connection failed; event subscriptions disabled", {
        url: ctx.runtimeConfig.nats.url,
        error: err instanceof Error ? err.message : String(err),
      });
      nats = null;
    }
    // Started only once the server is listening (below), so the first
    // session's overlay refresh can never land before /scene is served.
    // Where the latest attempt looked for OBS, for the status reply. The
    // password stays inside the attempt.
    let lastObsUrl: string | null = null;
    const obs = new ObsConnection({
      open: async () => {
        const config = await readObsConnectionConfig(db, ctx.runtimeConfig.obs, ctx.logger);
        lastObsUrl = config.url;
        return openObsSession(config, ctx.logger);
      },
      // Refresh overlays on the first session only. It exists to recover
      // overlays after *this process* restarted; after a mere reconnect their
      // streams are intact, and a refresh would cut off whatever is playing.
      // The scene cache the legacy slobs bridge reads is rebuilt by
      // openObsSession on every session.
      onConnected: async (client, { first }) => {
        if (first) {
          await refreshOverlayBrowserSources(client, ctx.runtimeConfig.port, ctx.logger);
        }
      },
      logger: ctx.logger,
    });
    this.obs = obs;

    await initSubscriptions({
      nats,
      obs,
      obsStatus: () => obsStatusReply(obs, lastObsUrl),
      db,
      host,
      deliveryStore,
      moduleState,
      visibility,
      resolver,
      logger: ctx.logger,
    });

    this.server = createHttpServer({
      ctx,
      host,
      frameAssembler,
      sessionTokens,
      deliveryStore,
      moduleState,
      settingsDb: db,
      bootId,
    });
    ctx.logger.info("sceneManager listening", {
      port: ctx.runtimeConfig.port,
      bindHost: ctx.runtimeConfig.bindHost,
      bootId,
    });

    obs.start();
    // Block for the process lifetime — Bun.serve doesn't return a
    // promise that resolves on its own; hold the runtime here until
    // terminate() stops the server.
    await new Promise<void>(() => {});
  }

  async terminate(ctx: Context): Promise<void> {
    this.deliveryStore?.stopSweep();
    this.deliveryStore = null;
    this.server?.stop();
    this.server = null;
    await this.obs?.stop();
    this.obs = null;
    ctx.logger.info("sceneManager stopped");
  }
}
