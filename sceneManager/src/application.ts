import { describeRequestGuardPolicy } from "@woofx3/common/http/request-guard";
import type {
  ApplicationContext,
  IApplication,
  Logger,
  Application as RuntimeApplication,
} from "@woofx3/common/runtime";
import { createMessageBus } from "@woofx3/nats";
import type NATSClient from "@woofx3/nats/src/client";
import type { SceneManagerRuntimeConfig } from "./config";
import { DeliveryStore } from "./events/delivery-store";
import { closeDeliveriesToRemovedPlacements } from "./events/removed-placements";
import { GoogleFontCache } from "./fonts/google-font-cache";
import { createHttpServer } from "./http";
import { initSubscriptions } from "./nats-subscriptions";
import { type RefreshRequester, startRefreshRequests, systemRefreshTimers } from "./obs/refresh-request";
import { createObsService, type ObsService } from "./obs/service";
import { FrameAssembler, HttpBarkloaderFrameClient } from "./scene/frame-assembler";
import { FrameCatalog } from "./scene/frame-catalog";
import { MediaProxy } from "./scene/media-proxy";
import { linkedResources, ModuleStateWatch } from "./scene/module-state";
import { dbSceneBackupStore } from "./scene/scene-backups";
import { SceneDocuments } from "./scene/scene-documents";
import { OverlayHost } from "./scene/scene-host";
import { SessionTokenService, sceneTokenIssuer } from "./scene/session-token";
import { OverlayTokenResolver } from "./scene/token-resolver";
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
  private deliveryStore: DeliveryStore | null = null;
  private obs: ObsService | null = null;
  private sceneDocuments: SceneDocuments | null = null;
  private nats: NATSClient | null = null;
  private refreshRequester: RefreshRequester | null = null;

  constructor(runtimeConfig: SceneManagerRuntimeConfig) {
    this.context = { runtimeConfig };
  }

  async run(ctx: Context): Promise<void> {
    try {
      await this.start(ctx);
    } catch (err) {
      // A start that fails part way (the port taken, say) must not leave
      // the bus connection or the redelivery sweep running behind it.
      await this.release();
      throw err;
    }
    // Block for the process lifetime — Bun.serve doesn't return a
    // promise that resolves on its own; hold the runtime here until
    // terminate() stops the server.
    await new Promise<void>(() => {});
  }

  private async start(ctx: Context): Promise<void> {
    const { runtimeConfig, logger } = ctx;
    // Identity of this process, announced on every SSE stream so a
    // reconnecting overlay can tell a resumed stream from one that came
    // back against a restarted sceneManager (see routes/events.ts).
    const bootId = crypto.randomUUID();

    const db = ctx.services.db.client;
    const resolver = new OverlayTokenResolver(db, logger);
    const barkloader = new HttpBarkloaderFrameClient(runtimeConfig.barkloaderUrl, runtimeConfig.barkloaderKey, logger);
    const framing = new FrameCatalog(barkloader, logger, (moduleId) => linkedResources(db, moduleId));
    const host = new OverlayHost(resolver, db, logger, { framing });
    const mediaProxy = new MediaProxy(runtimeConfig.barkloaderKey);
    const sessionTokens = new SessionTokenService(runtimeConfig.tokenSecret);

    const deliveryStore = new DeliveryStore(db, logger);
    // Edits are written back here, so the database stays each scene's record.
    const sceneDocuments = new SceneDocuments(host, deliveryStore, logger, {
      mediaProxy,
      persister: { updateScene: (write) => db.writeScene(write) },
      backups: dbSceneBackupStore(db),
    });
    this.sceneDocuments = sceneDocuments;
    const frameAssembler = new FrameAssembler(host, logger, {
      barkloader,
      linkedResources: (moduleId) => linkedResources(db, moduleId),
      mediaProxy,
    });
    // Held before hydrating, so a start that fails after this still stops
    // the store's timers.
    this.deliveryStore = deliveryStore;
    // Hydrate from the DB before accepting any traffic — a restart must
    // never silently drop in-flight events; one that cannot read the DB
    // keeps trying in the background.
    await deliveryStore.startHydration();
    deliveryStore.startSweep();
    const moduleState = new ModuleStateWatch(db, deliveryStore, logger);

    // NATS and OBS are both best-effort, non-blocking dependencies: scenes
    // are served without them, so neither goes through the shared runtime's
    // health-monitor-gated startup, which would hold scene serving back.
    const nats = await connectBus(runtimeConfig, logger);
    this.nats = nats;
    // Started only once the server is listening (below); the overlay refresh
    // is requested after that, so it can never land before /scene is served.
    const obs = createObsService({ db, nats, obs: runtimeConfig.obs, logger });
    this.obs = obs;
    const tokens = sceneTokenIssuer(sessionTokens, async (sceneId) => (await host.loadSceneById(sceneId)) !== null);

    await initSubscriptions({
      nats,
      obs: obs.connection,
      obsStatus: () => obs.status(),
      relayConfigMovesObs: () => obs.relayConfigMovesObs(),
      db,
      host,
      deliveryStore,
      moduleState,
      resolver,
      sceneDocuments,
      requestOverlayRefresh: (request) => obs.requestOverlayRefresh(request),
      editorToken: tokens.editorToken,
      previewToken: tokens.previewToken,
      logger,
    });

    this.server = createHttpServer({
      ctx,
      host,
      frameAssembler,
      sessionTokens,
      deliveryStore,
      moduleState,
      settingsDb: db,
      sceneDocuments,
      fonts: new GoogleFontCache(runtimeConfig.fontCacheDir, logger),
      mediaProxy,
      bootId,
    });
    logger.info("sceneManager listening", {
      port: this.server.port,
      bindHost: runtimeConfig.bindHost,
      bootId,
      ...describeRequestGuardPolicy(runtimeConfig.requestGuard),
    });

    obs.start();
    const overlayPort = this.listeningPort();
    if (overlayPort === null) {
      throw new Error("sceneManager: the HTTP server reports no listening port");
    }
    if (nats === null) {
      // No bus to ask over, and this process holds the OBS connection itself.
      obs.requestOverlayRefresh({ overlayPort, bootId });
    } else {
      this.refreshRequester = startRefreshRequests(
        { overlayPort, bootId },
        {
          bus: nats,
          config: runtimeConfig.obsRefresh,
          random: { next: Math.random },
          timers: systemRefreshTimers,
          logger,
        }
      );
    }

    // Placements removed while this process was down left deliveries no page
    // will queue; checked once the server is up, so it never holds serving back.
    for (const sceneId of deliveryStore.scenesWithOpenDeliveries()) {
      void closeDeliveriesToRemovedPlacements(sceneId, { host, deliveryStore, logger });
    }
  }

  /** The port the server is listening on, once it is; the one the OS chose when configured with 0. */
  listeningPort(): number | null {
    return this.server?.port ?? null;
  }

  async terminate(ctx: Context): Promise<void> {
    await this.release();
    ctx.logger.info("sceneManager stopped");
  }

  /** Stops whatever has been started, in any state `start` may have left. */
  private async release(): Promise<void> {
    // Edits still waiting to be written would otherwise be lost with the process.
    await this.sceneDocuments?.close();
    this.sceneDocuments = null;
    this.deliveryStore?.stopSweep();
    this.deliveryStore = null;
    // Forced: open event streams would otherwise hold the server, and their
    // heartbeats, past shutdown.
    await this.server?.stop(true);
    this.server = null;
    await this.refreshRequester?.stop();
    this.refreshRequester = null;
    await this.obs?.stop();
    this.obs = null;
    // Last, so nothing above is left publishing onto a closed connection.
    await this.nats?.close();
    this.nats = null;
  }
}

/** The message bus, connected; null when it cannot be reached, which the scene manager runs without. */
async function connectBus(runtimeConfig: SceneManagerRuntimeConfig, logger: Logger): Promise<NATSClient | null> {
  try {
    const nats = await createMessageBus(runtimeConfig.nats, logger);
    await nats.connect();
    return nats;
  } catch (err) {
    logger.warn("NATS connection failed; event subscriptions disabled", {
      url: runtimeConfig.nats.url,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
