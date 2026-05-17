// Shared API Types for woofx3 UI and Backend

import type { ActionDefinition, TriggerDefinition } from "./webhooks";
import type { WorkflowDefinition } from "./workflow-definition";

// ==================== User & Auth ====================

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: string;
  teamIds: string[];
  accountIds: string[];
}

// ==================== Teams ====================

export interface Team {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: string;
}

/**
 * role / status are `string` at the wire level (engine uses free-form
 * strings today). Well-known values are documented below so UI callers
 * can narrow with `switch` or discriminated unions as needed.
 *
 * Known roles: "owner" | "admin" | "member"
 * Known statuses: "active" | "invited" | "inactive"
 */
export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  joinedAt: string;
  avatarUrl: string;
}

// ==================== Accounts ====================

export interface Account {
  id: string;
  name: string;
  platform: string;
  teamId: string;
  status: string;
  createdAt: string;
}

// ==================== Modules ====================

/**
 * Catalog row returned by getModules. `category` is optional because
 * engine-side mapping from the DB module record doesn't always have it
 * populated — the workflow builder defaults to "General" when missing.
 */
export interface Module {
  id: string;
  name: string;
  description: string;
  category?: string;
  version: string;
  author: string;
  isInstalled: boolean;
  iconUrl: string;
}

export interface ModulesQuery {
  category?: string;
  search?: string;
  installed?: boolean;
  page?: number;
  pageSize?: number;
}

export interface PaginatedModules {
  modules: Module[];
  total: number;
  page: number;
  pageSize: number;
}

// ==================== Workflows ====================

export interface WorkflowStats {
  runsToday: number;
  successRate: number;
}

/**
 * Workflow shape as returned by the engine's Api class (matches WorkflowItem
 * inside api/src/api.ts). `isEnabled` is the source-of-truth boolean;
 * `definition` is the canonical `WorkflowDefinition` JSON, or null if the
 * row exists but has no definition stored yet (shouldn't happen for
 * workflows created via the new RPC). `stats` and timestamps are always
 * populated by the engine.
 */
export interface Workflow {
  id: string;
  name: string;
  description: string;
  accountId: string;
  isEnabled: boolean;
  definition: WorkflowDefinition | null;
  stats: WorkflowStats;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowsQuery {
  accountId?: string;
  enabled?: boolean;
  page?: number;
  pageSize?: number;
}

export interface PaginatedWorkflows {
  workflows: Workflow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Create a workflow from a canonical `WorkflowDefinition`. The engine
 * mints the `id` server-side, so callers pass the definition without it.
 */
export interface CreateWorkflowInput {
  accountId: string;
  definition: Omit<WorkflowDefinition, "id">;
  correlationKey?: string;
}

/**
 * Update an existing workflow by replacing its canonical definition. The
 * definition's `id` must match the path id.
 */
export interface UpdateWorkflowInput {
  definition: WorkflowDefinition;
  correlationKey?: string;
}

/**
 * Minimal response for create/update CRUD round-trips. The full snapshot
 * (including timestamps) reaches Convex via the `workflow.*` webhook;
 * callers of the RPC only need id + definition + isEnabled to confirm
 * the engine accepted the mutation.
 */
export interface WorkflowMutationResult {
  id: string;
  definition: WorkflowDefinition;
  isEnabled: boolean;
}

/**
 * Row returned by getWorkflowRuns. `status` is `string` at the wire level;
 * known values today are "success" | "failed" | "running" but the engine
 * may add more (e.g. "cancelled", "timeout") without breaking the
 * contract.
 */
export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  status: string;
  startedAt: string;
  duration: number;
  trigger: string;
}

export interface WorkflowRunsQuery {
  workflowId?: string;
  accountId?: string;
  limit?: number;
}

// ==================== Twitch ====================

/**
 * Mirrors Twurple's `AccessTokenWithUserId` shape — what
 * `bootstrap()` parses from the engine's `twitch_token` setting and
 * passes to `RefreshingAuthProvider.addUserForToken`. Field names
 * match Twurple's expectations verbatim.
 */
export interface TwitchAccessToken {
  accessToken: string;
  refreshToken: string;
  scope: string[];
  expiresIn: number;
  obtainmentTimestamp: number;
  userId: string;
}

// ==================== Commands ====================

export type CommandType = "static" | "dynamic" | "function";

/**
 * Snapshot of a chat command as the engine stores it. `typeValue` carries
 * the type-discriminated payload: response text for `static`, template
 * string for `dynamic`, function name for `function`.
 */
export interface CommandSnapshot {
  id: string;
  applicationId: string;
  command: string;
  type: CommandType;
  typeValue: string;
  cooldown: number;
  priority: number;
  enabled: boolean;
}

export interface CreateCommandInput {
  command: string;
  type: CommandType;
  typeValue: string;
  cooldown: number;
  priority?: number;
  enabled: boolean;
}

/**
 * Manifest descriptor for a UI field whose options are populated
 * dynamically. Today only `internal` (NATS request/reply via the
 * engine) is supported; `http` is reserved for future use.
 *
 * For `internal`, the engine publishes a CloudEvent on `request.event`
 * via NATS request/reply. Workers reply with `msg.respond(...)`. The
 * engine forwards the reply back to Convex via the
 * `engine.response.received` webhook, which lands in the originating
 * action's `transientEvents` row keyed on correlationKey.
 */
export interface FieldOptionsDescriptor {
  kind: "internal";
  request: {
    event: string;
    payload?: Record<string, unknown>;
  };
  timeoutMs?: number;
}

/**
 * One function registered by an installed module. Aggregated across all
 * modules by `listAvailableFunctions`. `qualifiedName` is the form that
 * chat-command rows store as `typeValue` (matches barkloader's
 * `module/function` lookup path in ModuleRegistry).
 */
export interface AvailableFunction {
  id: string;
  moduleId: string;
  moduleName: string;
  /** Stable manifest-local function id (was `functionName` before the
   * rename to align with `triggers.manifest_id` and
   * `actions.manifest_id`). Forms the canonical id
   * `{moduleId}:function:{manifestId}`. */
  manifestId: string;
  /** Display name of the function. Distinct from `manifestId`. */
  name: string;
  /** Slash-separated barkloader invoke path (`{moduleName}/{manifestId}`). */
  qualifiedName: string;
  runtime: string;
}

/**
 * Full-replace update; the engine's UpdateCommand proto requires every
 * field, so the contract mirrors that rather than offering partial
 * patches. Callers should send the merged result of (current snapshot ∪
 * user changes).
 */
export interface UpdateCommandInput {
  command: string;
  type: CommandType;
  typeValue: string;
  cooldown: number;
  priority: number;
  enabled: boolean;
}

// ==================== Assets ====================

export interface Asset {
  id: string;
  name: string;
  type: string;
  url: string;
  accountId: string;
  size: number;
  createdAt: string;
}

export interface AssetsQuery {
  accountId?: string;
  type?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface PaginatedAssets {
  assets: Asset[];
  total: number;
  page: number;
  pageSize: number;
}

// ==================== Scenes ====================

export interface SceneWidget {
  id: string;
  type: string;
  position: { x: number; y: number };
  size: { w: number; h: number };
}

export interface Scene {
  id: string;
  name: string;
  accountId: string;
  widgets: SceneWidget[];
  createdAt: string;
}

export interface ScenesQuery {
  accountId?: string;
  page?: number;
  pageSize?: number;
}

export interface PaginatedScenes {
  scenes: Scene[];
  total: number;
  page: number;
  pageSize: number;
}

// ==================== Chat & Events ====================

export interface ChatMessage {
  id: string;
  user: string;
  message: string;
  timestamp: string;
  badges: string[];
  color: string;
}

/**
 * Real-time stream event delivered by the engine. Known types today:
 * "follow" | "subscription" | "donation" | "raid" | "cheer" | "gift"
 * (plus platform-specific extensions). Typed as `string` so new event
 * types from the engine don't break the contract.
 */
export interface StreamEvent {
  id: string;
  type: string;
  user: string;
  amount?: number;
  message?: string;
  timestamp: string;
}

export interface StreamEventsQuery {
  accountId: string;
  limit?: number;
  types?: string[];
}

// ==================== User Preferences ====================

export interface UserPreferences {
  email: boolean;
  push: boolean;
  workflow: boolean;
  marketing: boolean;
}

// ==================== Dashboard ====================

/**
 * Entry in a user's dashboard layout. The engine stores `config` as an
 * opaque per-widget-type payload; consumers render / edit it based on
 * `type`. Position / size are UI-local concerns and aren't persisted here.
 */
export interface DashboardModule {
  id: string;
  type: string;
  title: string;
  config?: Record<string, unknown>;
}

export interface DashboardStats {
  activeWorkflows: number;
  totalWorkflows: number;
  installedModules: number;
  totalModules: number;
  activeAccounts: number;
  recentEvents: number;
}

// ==================== Module lifecycle response types ====================

/**
 * Response from `installModuleZip`. The install runs asynchronously on the
 * engine — `success` only indicates the engine accepted the request. The
 * final outcome arrives via the `module.installed` / `module.install_failed`
 * webhook, correlated by `moduleKey`.
 */
export interface ModuleInstallZipResponse {
  success: boolean;
  message?: string;
  alreadyInstalled?: boolean;
}

/**
 * Response from `uninstallModule` / `uninstallEngineModule`. The actual
 * removal is asynchronous; the outcome arrives via the `module.deleted`
 * or `module.delete_failed` webhook, correlated by `moduleKey`.
 */
export interface UninstallModuleResponse {
  requested: boolean;
}

/** Summary row returned by `listEngineModules`. */
export interface EngineModuleSummary {
  name: string;
  version: string;
  state: string;
}

// ==================== Stream / workflow response types ====================

export interface StreamStatus {
  isLive: boolean;
  uptime: string;
  viewerCount: number;
  startedAt?: string;
  /**
   * Current stream title from Helix `getStreamByUserId`. Optional —
   * the mock implementation omits it; older engines that pre-date the
   * Helix-backed impl will too.
   */
  streamTitle?: string;
  /**
   * Game / category name from Helix. Same optionality contract as
   * `streamTitle`.
   */
  gameName?: string;
  /**
   * Broadcaster's Twitch user id, echoed back so the UI can correlate
   * the row with its own platform-link record. Optional — same reasons
   * as the other extended fields.
   */
  twitchUserId?: string;
}

export interface TriggerWorkflowResponse {
  executionId: string;
  status: string;
  message: string;
}

// ==================== API Interface ====================

/** RPC connectivity check; mirrors `GET /health` semantics. */
export type PingResponse = { status: "ok"; instanceId: string };

/**
 * Gateway is the capnweb entry point. Unauthenticated callers see only
 * `ping()` and `authenticate()`. A successful `authenticate()` returns
 * the full `Woofx3EngineApi` stub.
 */
export interface Woofx3EngineGateway {
  ping(): Promise<{ status: string }>;
  authenticate(clientId: string, clientSecret: string): Woofx3EngineApi;
  registerClient(
    description: string,
    callbackUrl?: string,
    callbackToken?: string
  ): Promise<{ clientId: string; clientSecret: string }>;
}

/**
 * Deployment-level information the UI needs to construct URLs and
 * compose widget previews. Returned by `getEngineInfo()` — typically
 * called once per UI session and cached.
 *
 * `widgetAssetBaseUrl` is the URL prefix that serves widget assets
 * from whichever storage backend the engine's repository is
 * configured to write to (Convex storage, R2/S3 public bucket,
 * CloudFront in front of S3, etc.). The operator sets this via the
 * UI settings form; it lives in the engine's `settings` table.
 *
 * Composition pattern (subject to the storage backend's URL scheme):
 *   `${widgetAssetBaseUrl}/${moduleKey}/${manifestId}/${entry}`
 *
 * Empty string is a valid value — it signals "storage not
 * configured." The UI editor falls back to a "widget unavailable"
 * placeholder in that state.
 *
 * `engineSceneOverlayBaseUrl` is the URL prefix that serves the
 * streamware overlay HTML. The full per-scene URL is
 * `${engineSceneOverlayBaseUrl}/${engineSceneId}`. The UI's browser-
 * source page iframes that URL.
 */
export interface EngineInfo {
  widgetAssetBaseUrl: string;
  engineSceneOverlayBaseUrl: string;
}

/**
 * Storage backend configuration the engine reads at startup to
 * construct its Repository. Persisted in the engine `settings` table
 * keyed by `storage.*` keys; barkloader fetches these on boot via
 * the db-proxy GetSetting RPC and rebuilds the repository from them.
 *
 * Restart is required after changing the provider — barkloader does
 * not hot-reload repository configuration today.
 *
 * Provider semantics:
 *   - "file": local disk via FileRepository. `destination` is the
 *     filesystem path; everything else is ignored.
 *   - "s3": S3-compatible (AWS S3, Cloudflare R2, MinIO). Uses
 *     `bucket` + `region` for AWS S3; add `endpoint` to point at R2
 *     (`https://<account>.r2.cloudflarestorage.com`) or MinIO. Set
 *     `forcePathStyle: true` for MinIO.
 *
 * Credentials are persisted in the settings table — the operator is
 * responsible for protecting that surface. AWS S3 deployments can
 * leave `accessKey` / `secretKey` empty to use the engine's default
 * AWS credential chain (instance profile, env vars, etc.).
 */
export interface StorageConfig {
  provider: "file" | "s3";
  // File-backed
  destination?: string;
  // S3 / R2 / MinIO
  bucket?: string;
  prefix?: string;
  region?: string;
  endpoint?: string;
  accessKey?: string;
  secretKey?: string;
  forcePathStyle?: boolean;
}

export interface Woofx3EngineApi {
  ping(): Promise<PingResponse>;

  /**
   * Deployment URLs the UI needs to compose iframe sources. Returned
   * once per session and cached client-side. Stable for the lifetime
   * of a given engine deployment; if it changes (e.g. CDN reconfig)
   * the UI must re-fetch.
   */
  getEngineInfo(): Promise<EngineInfo>;

  /**
   * Set the widget asset base URL that `getEngineInfo()` returns.
   * The operator wires this to whichever storage backend the
   * engine's repository writes to — Convex storage URL, R2 public
   * bucket, S3 with CDN, etc. Empty string clears the setting.
   * Wired to the UI settings form.
   */
  setWidgetAssetBaseUrl(value: string): Promise<{ success: boolean }>;

  /**
   * Read the current storage backend configuration from engine
   * settings. Credentials (accessKey/secretKey) are masked or
   * returned blank to the UI — the operator can write new values
   * but cannot read existing ones.
   */
  getStorageConfig(): Promise<StorageConfig>;

  /**
   * Persist storage backend configuration to engine settings. The
   * engine reads these on next startup to construct its Repository.
   * Restart required after changing the provider.
   */
  setStorageConfig(config: StorageConfig): Promise<{ success: boolean }>;

  // Client Management
  deleteClient(clientId: string): Promise<{ success: boolean; message: string }>;

  // User & Auth
  getUser(): Promise<User>;

  // Teams
  getTeams(): Promise<Team[]>;
  getTeam(id: string): Promise<Team | null>;
  getTeamMembers(teamId: string): Promise<TeamMember[]>;

  // Accounts
  getAccounts(teamId?: string): Promise<Account[]>;
  getAccount(id: string): Promise<Account | null>;

  // Modules — catalog + async install/uninstall lifecycle
  getModules(query?: ModulesQuery): Promise<PaginatedModules>;
  getModule(id: string): Promise<Module | null>;

  /**
   * Deliver a zipped module archive to the engine for installation. The
   * engine performs the install asynchronously and fires a
   * `module.installed` or `module.install_failed` webhook, correlated by
   * `context.moduleKey` (echoed back in the callback).
   *
   * `clientId` is injected automatically by the authenticated ApiSession;
   * callers only provide `moduleKey` for correlation.
   */
  installModuleZip(
    fileName: string,
    zipBase64: string,
    context?: { moduleKey?: string }
  ): Promise<ModuleInstallZipResponse>;

  /**
   * Install a module by URL. The engine fetches the archive server-side from
   * `downloadUrl` (a short-lived presigned URL produced by an upstream
   * marketplace), then hands the bytes to barkloader. Install is asynchronous;
   * `module.installed` or `module.install_failed` is dispatched via webhook
   * once barkloader finishes, correlated by `moduleKey`.
   *
   * `clientId` is injected automatically by the authenticated ApiSession;
   * callers only provide `moduleKey` and the metadata `ctx`.
   *
   * `ctx` is used for logging and for echoing fields back through the
   * webhook payload (so the UI can show "Installing OBS Scenes v1.4.2 from
   * marketplace..." without an extra round-trip). Barkloader's parsed manifest
   * remains the source of truth for the module's actual name/version.
   */
  installModuleFromUrl(
    downloadUrl: string,
    moduleKey: string,
    ctx: {
      name: string;
      version: string;
      source: "marketplace";
      marketplaceModuleId: string;
    }
  ): Promise<ModuleInstallZipResponse>;

  /** Lightweight summary of every module currently installed on the engine. */
  listEngineModules(): Promise<EngineModuleSummary[]>;

  /**
   * Request an async uninstall by module id. Returns `{ requested: true }`
   * immediately; the actual outcome arrives via the `module.deleted` or
   * `module.delete_failed` webhook, both carrying `moduleKey`. `clientId`
   * is injected by the authenticated session.
   */
  /**
   * Preferred uninstall path. `moduleKey` is the composite
   * `{moduleId}:{version}:{hash}` — the only stable cross-version,
   * cross-engine identifier for an installed module. The engine
   * resolves it to the underlying module name and forwards the
   * uninstall to barkloader.
   */
  uninstallModule(moduleKey: string): Promise<UninstallModuleResponse>;

  /** Lower-level equivalent of uninstallModule keyed on engine module name. */
  uninstallEngineModule(name: string, context?: { moduleKey?: string }): Promise<UninstallModuleResponse>;

  // Triggers & actions catalog
  getTriggers(createdByType?: string, createdByRef?: string): Promise<TriggerDefinition[]>;
  getActions(createdByType?: string, createdByRef?: string): Promise<ActionDefinition[]>;

  // Workflows
  getWorkflows(query?: WorkflowsQuery): Promise<PaginatedWorkflows>;
  getWorkflow(id: string): Promise<Workflow | null>;
  createWorkflow(data: CreateWorkflowInput): Promise<WorkflowMutationResult>;
  updateWorkflow(id: string, data: UpdateWorkflowInput): Promise<WorkflowMutationResult | null>;
  deleteWorkflow(id: string, correlationKey?: string): Promise<boolean>;
  setWorkflowEnabled(
    id: string,
    isEnabled: boolean,
    correlationKey?: string
  ): Promise<{ id: string; isEnabled: boolean }>;
  getWorkflowRuns(query?: WorkflowRunsQuery): Promise<WorkflowRun[]>;

  // Commands (chat command CRUD on the engine — synchronous, emits
  // command.created / command.updated / command.deleted cloudevents on success)
  createCommand(data: CreateCommandInput): Promise<CommandSnapshot>;
  updateCommand(id: string, data: UpdateCommandInput): Promise<CommandSnapshot>;
  deleteCommand(id: string): Promise<{ deleted: boolean }>;
  // Sync — full snapshot list for reconciliation against the Convex mirror
  listCommands(): Promise<CommandSnapshot[]>;

  // Discovery — aggregated module function list for UI dropdowns.
  // Backed by db.listModules(); each module row carries its functions.
  listAvailableFunctions(): Promise<AvailableFunction[]>;

  // Twitch token persistence — bridges the UI's OAuth callback to the
  // engine's bootstrap, which reads `twitch_token` from db settings.
  // `convexUserId` (optional) gets resolved to an engine-side user UUID
  // and stored on settings.user_id so the row is properly user-scoped.
  setTwitchToken(token: TwitchAccessToken, convexUserId?: string): Promise<{ ok: true }>;
  deleteTwitchToken(): Promise<{ ok: true }>;

  // Generic dynamic-options dispatch. Convex action calls this with the
  // descriptor parsed from a configFields entry; the engine fires a NATS
  // request and forwards the reply via webhook ENGINE_RESPONSE_RECEIVED.
  // Returns immediately (fire-and-forget on the engine side).
  dispatchFieldOptionsRequest(
    descriptor: FieldOptionsDescriptor,
    correlationKey: string
  ): Promise<{ dispatched: boolean }>;

  // Assets
  getAssets(query?: AssetsQuery): Promise<PaginatedAssets>;
  getAsset(id: string): Promise<Asset | null>;
  createAsset(data: {
    name: string;
    type: string;
    url: string;
    accountId: string;
    size: number;
  }): Promise<{ id: string }>;
  deleteAsset(id: string): Promise<{ success: boolean }>;

  // Scenes
  //
  // Mirrors the workflow CRUD shape: the engine treats widgetsJson +
  // layoutJson as opaque strings (same pattern as workflows'
  // stepsJson + triggerJson). The UI composes the widget-instance
  // array and layout object, JSON-encodes them, and forwards. Engine
  // persists verbatim and emits `scene.*` webhooks with the
  // SceneSnapshot for reactive UI mirrors to consume.
  getScenes(query?: ScenesQuery): Promise<PaginatedScenes>;
  getScene(id: string): Promise<Scene | null>;

  /**
   * Get all available widgets registered in the engine.
   * Used by the scene manager to populate the widget palette.
   */
  getAvailableWidgets(): Promise<{
    widgets: Array<{
      id: string;
      manifestId: string;
      name: string;
      description: string;
      directory: string;
      alertTypes: string[];
      settingsSchema: string;
      surface: string;
      createdByType: string;
      createdByRef: string;
    }>;
  }>;

  createScene(data: {
    name: string;
    accountId: string;
    description?: string;
    widgetsJson?: string;
    layoutJson?: string;
    correlationKey?: string;
  }): Promise<{ id: string }>;
  /**
   * Patch semantics — omit a field to leave it unchanged. Empty
   * string for `name` / `description` is allowed (clears it); pass
   * `undefined` to leave alone.
   */
  updateScene(
    id: string,
    data: {
      name?: string;
      description?: string;
      widgetsJson?: string;
      layoutJson?: string;
      correlationKey?: string;
    }
  ): Promise<{ success: boolean }>;
  deleteScene(id: string, correlationKey?: string): Promise<{ success: boolean }>;

  // Chat & Events
  getChatMessages(accountId: string, limit?: number): Promise<ChatMessage[]>;
  sendChatMessage(accountId: string, message: string): Promise<{ success: boolean; messageId: string }>;
  getStreamEvents(query: StreamEventsQuery): Promise<StreamEvent[]>;
  getStreamStatus(accountId: string): Promise<StreamStatus>;

  // Workflow execution (user-facing)
  triggerWorkflowByName(
    workflowName: string,
    parameters?: Record<string, string>,
    userId?: string
  ): Promise<TriggerWorkflowResponse>;

  // User Preferences
  getUserPreferences(): Promise<UserPreferences>;
  updateUserPreferences(prefs: UserPreferences): Promise<{ success: boolean }>;

  // Dashboard
  getDashboardStats(): Promise<DashboardStats>;
  getDashboardLayout(accountId: string): Promise<DashboardModule[]>;
  saveDashboardLayout(accountId: string, modules: DashboardModule[]): Promise<boolean>;

  // Alert log replay — re-publishes a previously recorded alert
  // envelope to `ui.notify.alert` with a fresh envelope id, so it
  // flows through the queue manager as a new dispatch. The
  // original row is marked `replayed`. Returns `false` when the id
  // doesn't exist or the stored payload is malformed; throws on
  // transport failures (NATS / db proxy unreachable).
  replayAlert(id: string): Promise<boolean>;

  // Operator controls (Phase 3) over the backend-authoritative
  // alert queue (`api/src/alert-queue-manager.ts`).
  //
  // `applicationId` is optional on each method: when omitted we
  // resolve to the authenticated session's application or the
  // engine's default application — matches the convention used by
  // listAlerts / getAlert.

  /**
   * Mark the currently-playing alert (if any) as `skipped`,
   * advance the queue to the next pending envelope. No-op when
   * nothing is in flight. Returns whether an alert was skipped.
   */
  skipCurrentAlert(applicationId?: string): Promise<{ skipped: boolean }>;

  /**
   * Mark every pending (not-yet-dispatched) alert as `skipped`.
   * Does not touch the in-flight lease; pair with `skipCurrentAlert`
   * for a full clear. Returns the number of pending alerts dropped.
   */
  clearAlertQueue(applicationId?: string): Promise<{ cleared: number }>;
}

// ==================== Widgets ====================
//
// Widgets are user-facing components that the Convex scene editor places
// onto a scene canvas. They render alerts and module-supplied data inside
// browser sources. There are two distinct concepts in this contract — keep
// them straight:
//
//   - WidgetDefinition  (in webhooks.ts): a *registered* widget exposed by
//     an installed barkloader module. One row per (module, manifestId).
//     Engine-owned, projected to the UI via the
//     module.widget.{registered,deregistered} webhooks.
//
//   - WidgetInstance    (here):           a *placement* of a registered
//     widget onto a specific scene canvas. UI-owned. Scene-specific.
//     Many instances can reference the same WidgetDefinition; many
//     scenes can share the same WidgetDefinition catalog.
//
// The boundary: the engine never sees WidgetInstances. The UI never owns
// WidgetDefinitions (only consumes them). They communicate through the
// `widgetDefinitionRef` field below, which is the canonical or projection
// id of the WidgetDefinition.

/**
 * A widget *placement* on a scene canvas. Persisted by the UI on
 * `scenes.widgets`. Consumed by the browser source at render time to
 * position + configure each on-screen widget.
 */
export interface WidgetInstance {
  /** Stable id within a scene. UI-generated. The engine never sees this. */
  id: string;
  /**
   * Reference to the registered WidgetDefinition. Prefer the definition's
   * `projectionKey` (`{moduleKey}:widget:{manifestId}`) for cross-instance
   * stability; fall back to `canonicalId` (`{moduleId}:widget:{manifestId}`)
   * for legacy rows. Resolution is the UI's responsibility.
   */
  widgetDefinitionRef: string;
  /** Optional human label displayed in the scene editor only. */
  label?: string;
  /**
   * When set, the widget is anchored to a `sceneSlots` row — `position`
   * and `size` are interpreted relative to the slot's bounds. When unset,
   * they're absolute on the scene canvas.
   */
  slotId?: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  /**
   * Per-instance configuration values, keyed by
   * `WidgetSettingDefinition.key`. Values must conform to the corresponding
   * setting's `fieldType`; the UI validates on save.
   */
  settings: Record<string, unknown>;
  /** z-order; higher renders on top. Defaults to 0 when omitted. */
  zIndex?: number;
  /** Toggle for hiding without deleting. Defaults to true when omitted. */
  visible?: boolean;
}

/**
 * Catalog response shape — what the engine returns when the UI asks "what
 * widgets does this module expose?". Mirrors `WidgetDefinition` but adds
 * fields the UI may want for richer presentation (install time, source
 * module summary). Used by the optional `listWidgets` Cap'n Web RPC; not
 * required for the webhook-driven path which carries `WidgetDefinition`
 * directly.
 */
export interface WidgetCatalogEntry {
  definition: import("./webhooks").WidgetDefinition;
  /** Composite moduleKey of the source module — surfaces parent context. */
  moduleKey: string;
  moduleName: string;
  moduleVersion: string;
  /** Registration timestamp, ISO 8601, set by the engine on insert. */
  installedAt: string;
}
