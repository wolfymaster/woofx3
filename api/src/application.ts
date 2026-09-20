import type { ApplicationContext, Application as RuntimeApplication, IApplication } from "@woofx3/common/runtime";
import type { SharedLogger } from "@woofx3/common/logging";
import type { ApiConfig } from "./config";
import type DbService from "./db-service";
import type { Msg } from "@woofx3/nats/src/types";

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
      { StreamEventBroadcaster },
      { StreamSessionResolver },
      { WebhookClient },
      { initWidgetStatusHandlers },
      { initWorkflowHandlers },
      { WorkflowRunEmitter },
      { initWorkflowRunHandlers },
      { default: BarkloaderClient },
      { checkReadiness, HEARTBEAT_SUBJECT, HeartbeatTracker },
      { ApplicationScope },
      { connectMessageBus },
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
      import("./stream-event-broadcaster"),
      import("./stream-session-resolver"),
      import("./webhook-client"),
      import("./widget-status-handlers"),
      import("./workflow-event-handlers"),
      import("./workflow-run-emitter"),
      import("./workflow-run-handlers"),
      import("@woofx3/barkloader"),
      import("./readiness"),
      import("./application-scope"),
      import("./message-bus"),
    ]);

    const config = ctx.runtimeConfig;
    const logger = ctx.logger as SharedLogger;
    const db = ctx.services.db.client;

    logger.info("Starting API server", { port: config.port || 8080 });

    // NATS is best-effort and non-blocking — kept outside the runtime's
    // health-monitor-gated service connect so the API still serves traffic
    // when the message bus is unavailable. It is waited for rather than tried
    // once: the orchestrator starts every service at once, and without a bus
    // no heartbeat ever arrives, so GET /ready would never see barkloader.
    logger.info("Connecting to NATS", { url: config.nats.url, name: config.nats.name });
    const natsClient = await connectMessageBus({
      connect: async () => {
        const client = await createMessageBus(config.nats, logger);
        await client.connect();
        return client;
      },
      logger,
    });
    if (natsClient) {
      logger.info("Connected to NATS");
    } else {
      logger.warn("Running in offline mode - some features may be unavailable");
    }

    // Runs module functions and waits for their result. It reconnects on its
    // own; until it is up, a webhook handler request answers 503.
    const functions = new BarkloaderClient({
      wsUrl: `${config.barkloaderWsUrl}?token=${encodeURIComponent(config.barkloaderKey)}`,
      onOpen: () => logger.info("Connected to barkloader"),
      onClose: () => logger.warn("Barkloader connection closed"),
      onError: () => logger.warn("Barkloader connection error"),
      maxRetries: Infinity,
      reconnectTimeout: 5000,
    });
    functions.connect();

    const api = new Api({
      db,
      nats: natsClient,
      functions,
      barkloaderUrl: config.barkloaderUrl,
      streamwareUrl: config.streamwareUrl,
      sceneManagerUrl: config.sceneManagerUrl,
      apiUrl: config.apiUrl,
      logger,
      version: config.version,
    });

    // Barkloader readiness for GET /ready, from the heartbeats every service
    // publishes. Without NATS nothing arrives, and /ready stays not-ready.
    const heartbeats = new HeartbeatTracker();
    if (natsClient) {
      await natsClient.subscribe(HEARTBEAT_SUBJECT, (msg: Msg) => {
        try {
          heartbeats.record(msg.json(), Date.now());
        } catch {
          // A heartbeat that is not JSON is not a heartbeat.
        }
      });
    }

    const webhookClient = new WebhookClient(db, logger, null);
    api.setWebhookClient(webhookClient);

    // Components that exist per application. They start here when the
    // engine is already registered, and otherwise at the first
    // registerClient, which creates the application (see ApiGateway).
    const applicationScope = new ApplicationScope(async (applicationId) => {
      const convexWebhookClient = new ConvexWebhookClient({ db, logger, applicationId });
      await convexWebhookClient.loadConfig();

      if (!natsClient) {
        logger.warn("Skipping AlertEmitter and StorageChangeEmitter; NATS client is not connected");
        return;
      }
      const alertEmitter = new AlertEmitter(natsClient, convexWebhookClient, applicationId, logger);
      await alertEmitter.start();

      const storageChangeEmitter = new StorageChangeEmitter(natsClient, webhookClient, logger);
      await storageChangeEmitter.start();

      // A session is scoped to an application; there is nothing to resolve
      // before onboarding.
      const streamSessionResolver = new StreamSessionResolver(natsClient, db, applicationId, logger, webhookClient);
      await streamSessionResolver.start();
    }, logger);

    try {
      const existing = await db.getDefaultApplication();
      if (existing) {
        api.setApplicationId(existing.id);
        await webhookClient.refreshCallbackUrls();
        logger.info("Warmed applicationId cache from existing default", { applicationId: existing.id });
        await applicationScope.start(existing.id);
      } else {
        logger.info("No default application yet; application-scoped components start at the first registration");
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
      // Started here rather than alongside AlertEmitter above: that block is
      // gated on a default application already existing, and this needs only
      // the bus — a dashboard should receive events before onboarding has
      // resolved an applicationId.
      const streamEventBroadcaster = new StreamEventBroadcaster(natsClient, logger);
      await streamEventBroadcaster.start();
      api.setStreamEventBroadcaster(streamEventBroadcaster);

      await initOverlayTokenHandlers(natsClient, webhookClient, logger);
      await initModuleHandlers(natsClient, webhookClient, logger);
      await initWorkflowHandlers(natsClient, webhookClient, logger);
      await initSceneHandlers(natsClient, webhookClient, logger);
      await initAlertLogHandlers(natsClient, webhookClient, logger);
      await initWidgetStatusHandlers(natsClient, webhookClient, logger);
      // Run history, projected from the db-proxy outbox. Distinct from
      // WorkflowRunEmitter below, which forwards live lifecycle for a caller
      // waiting on one run: this carries persisted rows for the history.
      await initWorkflowRunHandlers(natsClient, webhookClient, logger);

      // Needs only the bus and the webhook client, so it starts here rather
      // than in the applicationId-gated block above: each run event carries
      // its own applicationId, resolved by the engine that owns the workflow
      // definition.
      const workflowRunEmitter = new WorkflowRunEmitter(natsClient, webhookClient, logger);
      await workflowRunEmitter.start();
    }

    const auth = new ClientAuth(db, logger);
    api.setAuthInvalidate(() => auth.invalidateCache());
    const gateway = new ApiGateway(api, auth, db, logger, config.registrationToken);
    gateway.setWebhookClient(webhookClient);
    gateway.setApplicationScope(applicationScope);

    this.server = createHttpServer({
      port: config.port,
      hostname: config.host,
      readiness: () =>
        checkReadiness({
          version: config.version,
          migrationStatus: () => db.migrationStatus(),
          heartbeats,
          now: Date.now,
        }),
      logger,
      gateway,
      onProcessingCallback: (body) => api.handleProcessingCallback(body as never),
    });

    logger.info("API server started", {
      host: config.host,
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
