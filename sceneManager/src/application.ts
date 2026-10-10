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
  private sceneDocuments: import("./scene/scene-documents").SceneDocuments | null = null;

  constructor(runtimeConfig: SceneManagerRuntimeConfig) {
    this.context = { runtimeConfig };
  }

  async run(ctx: Context): Promise<void> {
    const { createHttpServer } = await import("./http");
    const { OverlayTokenResolver } = await import("./scene/token-resolver");
    const { OverlayHost } = await import("./scene/scene-host");
    const { FrameAssembler, HttpBarkloaderFrameClient } = await import("./scene/frame-assembler");
    const { FrameCatalog } = await import("./scene/frame-catalog");
    const { SceneDocuments } = await import("./scene/scene-documents");
    const { MediaProxy } = await import("./scene/media-proxy");
    const { EDITOR_TOKEN_TTL_SECONDS, SessionTokenService } = await import("./scene/session-token");
    const { sceneEditorPath } = await import("@woofx3/common/cloudevents/Scene/editor");
    const { DeliveryStore } = await import("./events/delivery-store");
    const { ModuleStateWatch, linkedResources } = await import("./scene/module-state");
    const { createMessageBus } = await import("@woofx3/nats");
    const { ObsConnection } = await import("./obs/connection");
    const { obsDialTarget, openObsOverRoute } = await import("./obs/settings");
    const { obsStatusReply } = await import("./obs/status");
    const { dialWebSocketEndpoint, endpointKeysFromManifest, EndpointRelayError, relayChangeMovesEndpoint } =
      await import("./endpoints/dialer");
    const { RELAY_CONFIG_SETTING, readStoredRelayConfig, requestRelayCredentialOverNats } = await import(
      "@woofx3/common/cloudevents/Relay/relay"
    );
    const { initSubscriptions } = await import("./nats-subscriptions");
    const { refreshOverlayBrowserSources } = await import("./obs/refresh-overlays");

    // Identity of this process, announced on every SSE stream so a
    // reconnecting overlay can tell a resumed stream from one that came
    // back against a restarted sceneManager (see routes/events.ts).
    const bootId = crypto.randomUUID();

    const db = ctx.services.db.client;
    const resolver = new OverlayTokenResolver(db, ctx.logger);
    const barkloader = new HttpBarkloaderFrameClient(ctx.runtimeConfig.barkloaderUrl, ctx.logger);
    const framing = new FrameCatalog(barkloader, ctx.logger, (moduleId) => linkedResources(db, moduleId));
    const host = new OverlayHost(resolver, db, ctx.logger, { framing });
    const mediaProxy = new MediaProxy(ctx.runtimeConfig.mediaProxySecret);
    const sessionTokens = new SessionTokenService(ctx.runtimeConfig.tokenSecret);

    const deliveryStore = new DeliveryStore(db, ctx.logger);
    // Edits are written back here, so the database stays each scene's record.
    const sceneDocuments = new SceneDocuments(host, deliveryStore, ctx.logger, {
      mediaProxy,
      persister: {
        updateScene: (write) =>
          db.updateScene({
            name: "",
            description: "",
            widgetsJson: "",
            layoutJson: "",
            draftWidgetsJson: "",
            draftLayoutJson: "",
            clearDraft: false,
            ...write,
          }),
      },
    });
    this.sceneDocuments = sceneDocuments;
    const frameAssembler = new FrameAssembler(host, ctx.logger, {
      barkloader,
      linkedResources: (moduleId) => linkedResources(db, moduleId),
      mediaProxy,
    });
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
    const readRelayConfig = async () => readStoredRelayConfig(await db.getSetting(RELAY_CONFIG_SETTING));
    const bus = nats;
    const requestRelayCredential = bus
      ? requestRelayCredentialOverNats((subject, data, opts) => bus.request(subject, data, opts))
      : null;
    const dialer: import("./endpoints/dialer").DialerDeps = {
      endpointKeys: async (moduleId, endpointId) =>
        endpointKeysFromManifest(await db.getModuleManifest(moduleId), endpointId),
      settings: (moduleId) => db.listModuleSettings(moduleId),
      secrets: (moduleId) => db.getModuleSecretValues(moduleId),
      // Read on every attempt, like the module settings, so a missed
      // `engine.relay.config.updated` is picked up on the next retry.
      relayConfig: readRelayConfig,
      relayCredential: async (force) => {
        if (!requestRelayCredential) {
          throw new Error("no message bus to ask the api for a relay credential");
        }
        return requestRelayCredential(force);
      },
      fetch,
      logger: ctx.logger,
    };
    const obsTarget = obsDialTarget(ctx.runtimeConfig.obs);
    // Where and how the latest attempt looked for OBS, for the status reply.
    // The password and any bridge ticket stay inside the attempt.
    let lastObs: import("./obs/status").ObsLastRoute | null = null;
    const obs = new ObsConnection({
      open: async () => {
        try {
          const route = await dialWebSocketEndpoint(dialer, obsTarget);
          lastObs = { route: route.route, address: route.address };
          return await openObsOverRoute(route, ctx.logger);
        } catch (err) {
          if (err instanceof EndpointRelayError) {
            lastObs = { route: "companion", address: err.address };
          }
          throw err;
        }
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
      obsStatus: () => obsStatusReply(obs, lastObs),
      relayConfigMovesObs: async () => relayChangeMovesEndpoint(await readRelayConfig(), obsTarget, lastObs),
      db,
      host,
      deliveryStore,
      moduleState,
      resolver,
      sceneDocuments,
      editorToken: async (sceneId) => {
        if (!(await host.loadSceneById(sceneId))) {
          return { ok: false, reason: "scene not found" };
        }
        return {
          ok: true,
          token: await sessionTokens.mintEditor({ sceneId }),
          expiresInSeconds: EDITOR_TOKEN_TTL_SECONDS,
          path: sceneEditorPath(sceneId),
        };
      },
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
      sceneDocuments,
      mediaProxy,
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
    // Edits still waiting to be written would otherwise be lost with the process.
    await this.sceneDocuments?.flush();
    this.sceneDocuments = null;
    this.deliveryStore?.stopSweep();
    this.deliveryStore = null;
    this.server?.stop();
    this.server = null;
    await this.obs?.stop();
    this.obs = null;
    ctx.logger.info("sceneManager stopped");
  }
}
