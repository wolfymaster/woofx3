import type { ApplicationContext, Application as RuntimeApplication, IApplication } from "@woofx3/common/runtime";
import type { SharedLogger } from "@woofx3/common/logging";
import type { ApiConfig } from "./config";
import type DbService from "./db-service";

export type ApiServices = {
  db: DbService;
};

export type ApiRuntimeContext = {
  runtimeConfig: ApiConfig;
};

type Context = ApplicationContext<ApiRuntimeContext, ApiServices>;

export type ApiApplicationHandle = RuntimeApplication<Context, ApiServices>;

/**
 * api's application shell. `run(ctx)` connects best-effort NATS, wires
 * the outbound webhook/alert/storage-change paths, and starts the HTTP
 * server — it blocks for the process lifetime — the shared runtime's
 * `applicationRunActor` treats a non-resolving promise as "running
 * normally" and only reacts if it rejects (see
 * `@woofx3/common/runtime/runtime.ts`). db connectivity is handled
 * upstream by the runtime via the registered `db` Service; NATS stays
 * outside that health-monitor-gated path and is treated as best-effort
 * so the API keeps serving traffic even when the message bus is down
 * (same "degrade gracefully" philosophy sceneManager uses for its own
 * optional NATS/OBS dependencies).
 */
export default class ApiApplication implements IApplication<ApiRuntimeContext, ApiServices> {
  readonly context: ApiRuntimeContext;
  readonly __finalContextType!: ApiRuntimeContext;
  private server: ReturnType<typeof Bun.serve> | null = null;

  constructor(runtimeConfig: ApiConfig) {
    this.context = { runtimeConfig };
  }

  async run(ctx: Context): Promise<void> {
    const [
      { createMessageBus },
      { initAlertLogHandlers },
      { AlertEmitter },
      { Api },
      { ClientAuth },
      { ConvexWebhookClient },
      { ApiGateway },
      { createHttpServer },
      { initModuleHandlers },
      { initOverlayTokenHandlers },
      { initSceneHandlers },
      { StorageChangeEmitter },
      { WebhookClient },
      { initWidgetStatusHandlers },
      { initWorkflowHandlers },
    ] = await Promise.all([
      import("@woofx3/nats"),
      import("./alert-log-handlers"),
      import("./alert-emitter"),
      import("./api"),
      import("./auth"),
      import("./convex-webhook-client"),
      import("./gateway"),
      import("./http"),
      import("./module-event-handlers"),
      import("./overlay-token-handlers"),
      import("./scene-event-handlers"),
      import("./storage-change-emitter"),
      import("./webhook-client"),
      import("./widget-status-handlers"),
      import("./workflow-event-handlers"),
    ]);

    const config = ctx.runtimeConfig;
    const logger = ctx.logger as SharedLogger;
    const db = ctx.services.db.client;

    logger.info("Starting API server", { port: config.port || 8080 });

    // NATS is best-effort and non-blocking — kept outside the runtime's
    // health-monitor-gated service connect so the API still serves
    // traffic when the message bus is unavailable.
    let natsClient: Awaited<ReturnType<typeof createMessageBus>> | null = null;
    try {
      logger.info("Connecting to NATS", { url: config.nats.url, name: config.nats.name });
      natsClient = await createMessageBus(config.nats, logger);
      await natsClient.connect();
      logger.info("Connected to NATS");
    } catch (err) {
      logger.warn("Failed to connect to NATS", { error: err });
      logger.warn("Running in offline mode - some features may be unavailable");
      natsClient = null;
    }

    const api = new Api({
      db,
      nats: natsClient,
      barkloaderUrl: config.barkloaderUrl,
      streamwareUrl: config.streamwareUrl,
      overlayPublicUrl: config.overlayPublicUrl,
      logger,
    });

    const webhookClient = new WebhookClient(db, logger, null);
    api.setWebhookClient(webhookClient);

    let convexWebhookClient: InstanceType<typeof ConvexWebhookClient> | null = null;
    let alertEmitter: InstanceType<typeof AlertEmitter> | null = null;
    let storageChangeEmitter: InstanceType<typeof StorageChangeEmitter> | null = null;

    try {
      const existing = await db.getDefaultApplication();
      if (existing) {
        api.setApplicationId(existing.id);
        await webhookClient.refreshCallbackUrls();
        logger.info("Warmed applicationId cache from existing default", { applicationId: existing.id });

        convexWebhookClient = new ConvexWebhookClient({
          db,
          logger,
          applicationId: existing.id,
        });
        await convexWebhookClient.loadConfig();

        if (natsClient) {
          alertEmitter = new AlertEmitter(natsClient, convexWebhookClient, existing.id, logger);
          await alertEmitter.start();

          storageChangeEmitter = new StorageChangeEmitter(natsClient, webhookClient, logger);
          await storageChangeEmitter.start();
        } else {
          logger.warn("Skipping AlertEmitter and StorageChangeEmitter; NATS client is not connected");
        }
      } else {
        logger.info("No default application yet; waiting for UI onboarding");
      }
    } catch (err) {
      logger.warn("Default-application warmup failed (continuing)", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // api.initSubscriptions() covers only the module.trigger.* and
    // twitch stream lifecycle subscriptions — the ones that need more
    // than (nats, webhookClient, logger) (see routes/subscriptions.ts's
    // doc comment). Every other event family is a self-contained
    // handler module initialised here directly, same shape as
    // initOverlayTokenHandlers.
    await api.initSubscriptions();

    if (natsClient) {
      await initOverlayTokenHandlers(natsClient, webhookClient, logger);
      await initModuleHandlers(natsClient, webhookClient, logger);
      await initWorkflowHandlers(natsClient, webhookClient, logger);
      await initSceneHandlers(natsClient, webhookClient, logger);
      await initAlertLogHandlers(natsClient, webhookClient, logger);
      await initWidgetStatusHandlers(natsClient, webhookClient, logger);
    }

    const auth = new ClientAuth(db, logger);
    api.setAuthInvalidate(() => auth.invalidateCache());
    const gateway = new ApiGateway(api, auth, db, logger);
    gateway.setWebhookClient(webhookClient);

    this.server = createHttpServer({ port: config.port, logger, gateway });

    logger.info("API server started", {
      port: config.port,
      httpEndpoint: `http://localhost:${config.port}/api`,
      wsEndpoint: `ws://localhost:${config.port}/api`,
      healthEndpoint: `http://localhost:${config.port}/health`,
    });

    // Block for the process lifetime — Bun.serve doesn't return a
    // promise that resolves on its own; hold the runtime here until
    // terminate() stops the server.
    await new Promise<void>(() => {});
  }

  async terminate(): Promise<void> {
    this.server?.stop();
    this.server = null;
  }
}
