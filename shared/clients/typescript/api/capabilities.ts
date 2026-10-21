import type { EngineHosting } from "./api";

/**
 * Engine capability ids: the features this engine build supports that a
 * client may need to detect before using. `getEngineCapabilities()` returns
 * exactly these values, so an id listed here is a promise the engine keeps.
 *
 * A client asks for this list rather than comparing `getEngineInfo().version`
 * against the release that shipped a feature: a build from source reports
 * `dev`, and a list keeps clients from tracking which release shipped what.
 * The capability table in docs/services/engine-capabilities.md records each
 * id's first release (its Since column) only so a client knows when every
 * supported engine has the id and its check can be removed.
 *
 * An id is `<area>.<feature>` in camelCase and never changes meaning once
 * shipped: a behavior change that clients must tell apart gets a new id.
 * Every id must also be listed in docs/services/engine-capabilities.md.
 */
export const ENGINE_CAPABILITIES = {
  /**
   * An Alert step's inline `layout` may be a composition (`{ layout, widgets,
   * behaviors }`: the canvas, placements keyed by id, and behaviors keyed by
   * id) as well as the list shape (`{ width, height, widgets: [] }`).
   */
  alertsCompositionLayout: "alerts.compositionLayout",
  /**
   * Ending the alert playing on every open overlay and dropping every alert
   * still waiting, each answered with a count: `skipCurrentAlert`, `clearAlertQueue`.
   */
  alertsQueueControls: "alerts.queueControls",
  /**
   * Upload grants that admit exactly the declared length: `requestUploadUrl`
   * requires `size`, `requestPosterUploadUrl` takes it, every grant's headers
   * carry `Content-Length`, and `getResourceUsage` totals what file
   * resources hold.
   */
  assetsSizedUploads: "assets.sizedUploads",
  /** Stream session history: `listStreamSessions`, `getStreamSession`, `getStreamSessionTotals`. */
  analyticsSessions: "analytics.sessions",
  /** Per-minute viewer/follower/subscriber series for a session: `getStreamSessionGauges`. */
  analyticsGauges: "analytics.gauges",
  /** Lifetime and per-session viewer totals and leaderboards: `getViewerTotals`, `getLeaderboard`. */
  analyticsAggregates: "analytics.aggregates",
  /** A session's counted events in time order, for its timeline: `getStreamSessionEvents`. */
  analyticsSessionEvents: "analytics.sessionEvents",
  /**
   * The engine's event log, the history behind `subscribeStreamEvents`:
   * `listEvents`, the event-type selection that decides what it logs
   * (`getEventLogSettings`, `setEventLogSelection`), and `subscribeStreamEvents`
   * taking the event types to push.
   */
  eventsLog: "events.log",
  /**
   * This engine runs on the streamer's own machine under the desktop app
   * (`getEngineInfo().hosting` is `local`). Advertised only by such an engine;
   * see HOSTING_ENGINE_CAPABILITIES.
   */
  engineLocalMode: "engine.localMode",
  /** Configuration bundle export, dry-run preview and import: `exportConfig`, `previewImport`, `importConfig`. */
  configBundles: "config.bundles",
  /**
   * The `ctx.obs` host extension and the `obs.control` manifest permission, which
   * a module that changes OBS or lists its names needs to install and run.
   */
  obsControl: "obs.control",
  /** The OBS connection's state and last failure: `getObsStatus`. */
  obsStatus: "obs.status",
  /**
   * A manifest's `local[]` endpoints, `setRelayConfig`, the
   * `relay.credential.requested` callback, and sceneManager's endpoint dialer
   * reaching OBS through the companion's bridge.
   */
  modulesLocalEndpoints: "modules.localEndpoints",
  /**
   * A manifest's `oauth[]` integrations, `ctx.oauth.request`, and finishing a
   * connect with `completeModuleOAuth`.
   */
  modulesOAuth: "modules.oauth",
  /** Reading an installed module's files for a read-only viewer: `listModuleFiles`, `getModuleFile`. */
  modulesFiles: "modules.files",
  /**
   * Installing from the marketplace by listing id, with the engine fetching
   * and verifying the archive itself: `installMarketplaceListing`,
   * `inspectMarketplaceListing`, `installMarketplaceBundle`.
   */
  modulesMarketplaceInstall: "modules.marketplaceInstall",
  /**
   * Marketplace catalog reads through the engine, answered with the
   * marketplace's JSON unchanged: `marketplaceSearch`, `marketplaceCounts`,
   * `marketplaceGetListing`, `marketplaceGetAuthor`, `marketplaceQuote`.
   */
  marketplaceCatalog: "marketplace.catalog",
  /**
   * A Twitch token that carries the app's `clientId` is renewed by asking the
   * dashboard that sent it (`twitch.token.requested`), not with a refresh
   * token, so the dashboard need not send one.
   */
  twitchDashboardTokens: "twitch.dashboardTokens",
  /**
   * The Stream info widget's Helix calls, made by the engine as the linked
   * broadcaster and answered with Twitch's own result:
   * `twitchGetChannelInformation`, `twitchGetGames`, `twitchSearchCategories`,
   * `twitchModifyChannelInformation`, `twitchCreateStreamMarker`.
   */
  twitchStreamInfo: "twitch.streamInfo",
  /**
   * The Ad breaks widget's Helix calls, made and answered like
   * `twitch.streamInfo`'s: `twitchGetAdSchedule`, `twitchSnoozeNextAd`.
   */
  twitchAds: "twitch.ads",
  /**
   * The Moderation widget's Helix calls, made and answered like
   * `twitch.streamInfo`'s: `twitchGetUsers`, `twitchGetBlockedTerms`,
   * `twitchAddBlockedTerm`, `twitchRemoveBlockedTerm`, `twitchBanUser`,
   * `twitchUnbanUser`, `twitchGetChatSettings`, `twitchUpdateChatSettings`.
   */
  twitchModeration: "twitch.moderation",
  /**
   * The Broadcast controls' and Shoutouts widget's Helix calls, made and
   * answered like `twitch.streamInfo`'s: `twitchSendChatMessage`,
   * `twitchSendChatAnnouncement`, `twitchSendShoutout`, `twitchGetChatters`.
   * Their user lookups are `twitchGetUsers`, which every engine with this id
   * also serves (`twitch.moderation`).
   */
  twitchChat: "twitch.chat",
  /**
   * The Pins widget's Helix calls (Twitch beta), made and answered like
   * `twitch.streamInfo`'s: `twitchGetChatPins`, `twitchPinChatMessage`,
   * `twitchUnpinChatMessage`, and `pin` on `twitchSendChatMessage`.
   */
  twitchPins: "twitch.pins",
  /** The Clip button's Helix call, made and answered like `twitch.streamInfo`'s: `twitchCreateClip`. */
  twitchClips: "twitch.clips",
  /**
   * Editing a scene live with sceneManager over editor socket protocol 1:
   * `getSceneEditorSession`, sequenced json0 ops per version, and autosave in
   * place of `updateScene`. No longer served; declared so a client can
   * recognise an engine that only speaks it.
   */
  scenesEditorSessions: "scenes.editorSessions",
  /**
   * Editing a scene live with sceneManager over editor socket protocol 2
   * (`@woofx3/api/scene-editor`): one ordered queue of items per editor across
   * the draft and the published scene, publish and discard as items, every
   * item answered exactly once, and reconnects that catch up from the
   * server's log or rebase onto a snapshot. The socket is opened with the
   * token `getSceneEditorSession` gives, and `protocol=2`.
   */
  scenesEditorSync: "scenes.editorSync",
  /**
   * A composition's behaviors (transitions, effects, activity windows) are
   * stored with it, published and draft, so they survive sceneManager
   * restarts and saves made elsewhere. Without it an engine keeps behaviors
   * only while sceneManager holds the scene, and a client should not offer
   * them.
   */
  scenesBehaviors: "scenes.behaviors",
  /**
   * Alert compositions stored in the engine: `listAlertCompositions`,
   * `getAlertComposition`, `createAlertComposition`,
   * `updateAlertComposition`, `deleteAlertComposition`, editing one with
   * `getSceneEditorSession`, and `kind` in the `scene.*` webhook snapshots.
   * An alert step never plays one by id: a client copies it into the step's
   * own layout.
   */
  compositionsAlerts: "compositions.alerts",
  /**
   * The alert editor's live preview: `getCompositionPreviewUrl`, and
   * sceneManager's `/preview/composition` page driven by the protocol in
   * `@woofx3/scene/runtime` (`preview-protocol.ts`).
   */
  compositionsPreview: "compositions.preview",
  /**
   * The dashboard's own data kept by the engine, with engine-wide revisions,
   * tombstones and conflict checks for a later sync: `listUISettings`,
   * `getUISetting`, `setUISetting`, `deleteUISetting`,
   * `listUISettingChangesSince`, and the `ui.setting.changed` webhook.
   */
  uiSettings: "ui.settings",
  /** Theme presets a widget declares, for the theme settings picker: `listWidgetThemes`. */
  widgetsThemes: "widgets.themes",
  /**
   * The `scene.widget.visibility` workflow action, which saves a placement's
   * `visible` on the published scene, and the `scenes` / `scenePlacements`
   * field sources its form uses.
   */
  workflowWidgetVisibility: "workflow.widgetVisibility",
  /** The values `${viewer.*}` can resolve in a workflow, for a condition editor: `listViewerFacts`. */
  workflowViewerFacts: "workflow.viewerFacts",
  /**
   * Each item of a condition's list value (an `in` or `not_in` item, a
   * `between` bound) is resolved, so it may be a `${...}` reference.
   */
  workflowConditionListReferences: "workflow.conditionListReferences",
} as const;

export type EngineCapability = (typeof ENGINE_CAPABILITIES)[keyof typeof ENGINE_CAPABILITIES];

/**
 * Version of the `EngineCapabilities` response shape itself, not of the
 * engine. It changes only if the response stops being a flat id list.
 */
export const ENGINE_CAPABILITIES_SCHEMA = 1;

/**
 * Returned by `getEngineCapabilities()`. `capabilities` is sorted and
 * unique. It is typed `string[]` rather than `EngineCapability[]` because a
 * client built against an older contract must tolerate ids it does not know.
 */
export interface EngineCapabilities {
  schema: typeof ENGINE_CAPABILITIES_SCHEMA;
  capabilities: string[];
}

/**
 * Ids declared here that this build does not advertise, so clients can name
 * them before or after the engine supports them. sceneManager serves only
 * editor socket protocol 2 (`scenes.editorSync`), and answers a protocol 1
 * socket (`scenes.editorSessions`) with HTTP 426.
 */
export const UNADVERTISED_ENGINE_CAPABILITIES: ReadonlySet<EngineCapability> = new Set<EngineCapability>([
  ENGINE_CAPABILITIES.scenesEditorSessions,
]);

/**
 * Ids that describe how an engine is run rather than what its build can do,
 * each advertised only by an engine whose deployment declares that hosting
 * (`EngineInfo.hosting`).
 */
export const HOSTING_ENGINE_CAPABILITIES: ReadonlyMap<EngineCapability, EngineHosting> = new Map<
  EngineCapability,
  EngineHosting
>([[ENGINE_CAPABILITIES.engineLocalMode, "local"]]);

/**
 * The capability ids this engine advertises, sorted and unique: every id its
 * build supports, plus the ids for `hosting` when the deployment declares one.
 */
export function supportedEngineCapabilities(hosting: EngineHosting | null = null): EngineCapability[] {
  return [...new Set(Object.values(ENGINE_CAPABILITIES))]
    .filter((id) => !UNADVERTISED_ENGINE_CAPABILITIES.has(id))
    .filter((id) => {
      const required = HOSTING_ENGINE_CAPABILITIES.get(id);
      return required === undefined || required === hosting;
    })
    .sort();
}
