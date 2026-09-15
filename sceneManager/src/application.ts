import type { ApplicationContext, Application as RuntimeApplication, IApplication } from "@woofx3/common/runtime";
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
    const { createMessageBus } = await import("@woofx3/nats");
    const { connectObs } = await import("./obs/manager");
    const { initSubscriptions } = await import("./nats-subscriptions");
    const { refreshOverlayBrowserSources } = await import("./obs/refresh-overlays");

    // Identity of this process, announced on every SSE stream so a
    // reconnecting overlay can tell a resumed stream from one that came
    // back against a restarted sceneManager (see routes/events.ts).
    const bootId = crypto.randomUUID();

    const db = ctx.services.db.client;
    const resolver = new OverlayTokenResolver(db, ctx.logger);
    const host = new OverlayHost(resolver, db, ctx.logger);
    const barkloader = new HttpBarkloaderFrameClient(ctx.runtimeConfig.barkloaderUrl, ctx.logger);
    const frameAssembler = new FrameAssembler(host, ctx.logger, { barkloader });
    const sessionTokens = new SessionTokenService(ctx.runtimeConfig.tokenSecret);

    const deliveryStore = new DeliveryStore(db, ctx.logger);
    // Hydrate from the DB before accepting any traffic — a restart
    // must never silently drop in-flight events.
    await deliveryStore.hydrate();
    deliveryStore.startSweep();
    this.deliveryStore = deliveryStore;

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
    const obs = await connectObs(ctx.runtimeConfig.obs, ctx.logger);

    await initSubscriptions({ nats, obs, db, host, deliveryStore, resolver, logger: ctx.logger });

    this.server = createHttpServer({ ctx, host, frameAssembler, sessionTokens, deliveryStore, bootId });
    ctx.logger.info("sceneManager listening", {
      port: ctx.runtimeConfig.port,
      bindHost: ctx.runtimeConfig.bindHost,
      bootId,
    });

    // Strictly after the server is listening: a refresh that lands
    // before we can serve /scene would just bounce the overlay into the
    // same disconnected state it was already in. Not awaited for
    // correctness -- overlays recover on their own regardless -- but
    // awaited here so a failure is logged before we block for the
    // process lifetime.
    await refreshOverlayBrowserSources(obs, ctx.runtimeConfig.port, ctx.logger);
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
    ctx.logger.info("sceneManager stopped");
  }
}
