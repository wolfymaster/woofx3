/**
 * Engine capability ids: the features this engine build supports that a
 * client may need to detect before using. `getEngineCapabilities()` returns
 * exactly these values, so an id listed here is a promise the engine keeps.
 *
 * Engine images are tagged rather than semver-versioned, so a client cannot
 * infer features from `getEngineInfo().version`. It asks for the list instead.
 *
 * An id is `<area>.<feature>` in camelCase and never changes meaning once
 * shipped: a behavior change that clients must tell apart gets a new id.
 * Every id must also be listed in docs/services/engine-capabilities.md.
 */
export const ENGINE_CAPABILITIES = {
  /** Stream session history: `listStreamSessions`, `getStreamSession`, `getStreamSessionTotals`. */
  analyticsSessions: "analytics.sessions",
  /** Per-minute viewer/follower/subscriber series for a session: `getStreamSessionGauges`. */
  analyticsGauges: "analytics.gauges",
  /** Lifetime and per-session viewer totals and leaderboards: `getViewerTotals`, `getLeaderboard`. */
  analyticsAggregates: "analytics.aggregates",
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
   * A Twitch token that carries the app's `clientId` is renewed by asking the
   * dashboard that sent it (`twitch.token.requested`), not with a refresh
   * token, so the dashboard need not send one.
   */
  twitchDashboardTokens: "twitch.dashboardTokens",
  /**
   * Editing a scene live with sceneManager: `getSceneEditorSession`, the
   * editor socket it opens (sequenced json0 ops on a draft and the published
   * scene, publish, discard) and autosave in place of `updateScene`.
   */
  scenesEditorSessions: "scenes.editorSessions",
  /**
   * Editing a scene live with sceneManager over editor socket protocol 2
   * (`@woofx3/api/scene-editor`): one ordered queue of items per editor across
   * the draft and the published scene, publish and discard as items, every
   * item answered exactly once, and reconnects that catch up from the
   * server's log or rebase onto a snapshot.
   */
  scenesEditorSync: "scenes.editorSync",
  /** Theme presets a widget declares, for the theme settings picker: `listWidgetThemes`. */
  widgetsThemes: "widgets.themes",
  /**
   * The `scene.widget.visibility` workflow action, which saves a placement's
   * `visible` on the published scene, and the `scenes` / `scenePlacements`
   * field sources its form uses.
   */
  workflowWidgetVisibility: "workflow.widgetVisibility",
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
 * them before or after the engine supports them. sceneManager serves editor
 * socket protocol 1 (`scenes.editorSessions`) until it moves to protocol 2
 * (`scenes.editorSync`).
 */
export const UNADVERTISED_ENGINE_CAPABILITIES: ReadonlySet<EngineCapability> = new Set<EngineCapability>([
  ENGINE_CAPABILITIES.scenesEditorSync,
]);

/** The capability ids this build supports, sorted and unique. */
export function supportedEngineCapabilities(): EngineCapability[] {
  return [...new Set(Object.values(ENGINE_CAPABILITIES))]
    .filter((id) => !UNADVERTISED_ENGINE_CAPABILITIES.has(id))
    .sort();
}
