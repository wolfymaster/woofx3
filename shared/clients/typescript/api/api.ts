// Shared API Types for woofx3 UI and Backend

import type { ActionDefinition, ModuleResourceUsage, ResourceInstanceDefinition, TriggerDefinition } from "./webhooks";
import type { WorkflowDefinition } from "./workflow-definition";

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

export interface ModuleSetting {
  id: string;
  moduleId: string;
  key: string;
  value: string;
  valueType: string;
}

export interface ModuleSettingsResponse {
  settings: ModuleSetting[];
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

/**
 * "text" responses are always template-resolved (`{user}`-style
 * substitution) before being sent to chat - there is no separate
 * "static"/"dynamic"/"eval" distinction, since plain literal text is just a
 * template with no `{...}` expressions in it. "function" invokes a
 * barkloader module function (`typeValue` is its qualified name) and uses
 * its return value as the response.
 */
export type CommandType = "text" | "function";

/** "public" always allows any user; "restricted" requires the invoking user
 * to belong to one of groupIds or be listed in usernames. */
export type CommandVisibility = "public" | "restricted";

/**
 * Snapshot of a chat command as the engine stores it. `typeValue` carries
 * the type-discriminated payload: response text (with `{template}`
 * variables) for `text`, function name for `function`.
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
  visibility: CommandVisibility;
  groupIds: string[];
  usernames: string[];
  /**
   * Optional "{variable}" placeholders declaring named arguments, e.g.
   * "{songTitle}" or "{userA} {userB}" - `command` itself never contains
   * braces, it's always the bare trigger word ("sr", "hug"). Applies to
   * both "text" and "function" types: "text" responses can reference
   * `{songTitle}` the same way they reference `{user}`; "function"
   * commands receive the extracted values in their invoke payload.
   *
   * Extraction rule: exactly one variable captures the entire remainder of
   * the message (not split on whitespace) - `!sr {songTitle}` against
   * "!sr Life is a highway" yields `songTitle: "Life is a highway"`. More
   * than one variable: every variable but the last consumes one
   * whitespace-delimited token, and the last captures whatever remains -
   * `!hug {userA} {userB}` against "!hug alice bob" yields
   * `userA: "alice", userB: "bob"`.
   *
   * Each `{name}` must be a single word or dot-separated words
   * (`^\w+(\.\w+)*$`) - no other characters are valid. The engine rejects
   * `createCommand`/`updateCommand` calls with an invalid name in this
   * pattern.
   */
  argumentPattern: string;
}

export interface CreateCommandInput {
  command: string;
  type: CommandType;
  typeValue: string;
  cooldown: number;
  priority?: number;
  enabled: boolean;
  visibility: CommandVisibility;
  groupIds?: string[];
  usernames?: string[];
  /** See `CommandSnapshot.argumentPattern` for the syntax/extraction rule
   * and naming restriction. Omit/empty string for a command with no named
   * arguments. */
  argumentPattern?: string;
  /** Echoed back on the `command.created` webhook so an optimistic local
   * insert can be reconciled without a re-fetch. */
  correlationKey?: string;
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
  visibility: CommandVisibility;
  groupIds?: string[];
  usernames?: string[];
  /** See `CommandSnapshot.argumentPattern`. */
  argumentPattern?: string;
  /** Echoed back on the `command.updated` webhook. */
  correlationKey?: string;
}

// ==================== Groups ====================

/**
 * A "user group" (role). Users are added to groups; commands (and other
 * resources in the future) are granted to groups. This is the only
 * permission concept the UI ever deals with directly - raw Casbin rules
 * are never exposed.
 */
export interface GroupSnapshot {
  id: string;
  applicationId: string;
  name: string;
  description: string;
  createdAt: string;
  /**
   * Built-in groups are seeded with every application and mirror Twitch's
   * badge model: `everyone`, `subscriber`, `vip`, `moderator`, `broadcaster`.
   * They cannot be renamed or deleted - the engine refuses both, so a UI
   * should render those affordances as disabled rather than relying on the
   * call failing. Membership of the four Twitch-derived ones is owned by the
   * Twitch state sync and will be overwritten if edited by hand;
   * `everyone` has no membership at all and matches every user implicitly.
   */
  isBuiltIn: boolean;
}

export interface CreateGroupInput {
  name: string;
  description?: string;
  /** Echoed back on the `group.created` webhook. */
  correlationKey?: string;
}

export interface UpdateGroupInput {
  name: string;
  description?: string;
  /** Echoed back on the `group.updated` webhook. */
  correlationKey?: string;
}

/**
 * One stored Casbin rule, as returned by `listPermissions()`. `ptype` selects
 * the rule family - "p" is a policy (v0=subject, v1=object, v2=action,
 * v3=effect) and "g"/"g2" are grouping rules (v0=subject, v1=group). This is
 * a diagnostic/read-only view of the derived policy cache; the source of
 * truth is groups, group membership, and command grants.
 */
export interface PermissionRule {
  id: number;
  applicationId: string;
  ptype: string;
  v0: string;
  v1: string;
  v2: string;
  v3: string;
  v4: string;
  v5: string;
}

export interface ListPermissionsQuery {
  /** Exact rule family, e.g. "p" or "g". Takes precedence over `ptypePrefix`. */
  ptype?: string;
  /** Rule-family prefix, e.g. "g" to match both "g" and "g2". */
  ptypePrefix?: string;
  /** Restrict to rules whose subject (v0) matches exactly. */
  subject?: string;
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
 * Deployment-level information the UI needs to construct URLs.
 * Returned by `getEngineInfo()` — typically called once per UI
 * session and cached.
 *
 * `overlayPublicUrl` is the single public base URL for reaching this
 * api's overlay surface — both what `mintOverlayToken`/`rotateOverlayToken`/
 * `listOverlayTokens` compose their returned `url` from
 * (`${overlayPublicUrl}/overlay/{token}/`), and, via the same
 * `/overlay/assets/...` route, every widget/module asset kind
 * (module-contributed widgets and generic assets, builtin
 * (engine-bundled) widgets, and reserved user uploads). There is
 * deliberately only one such setting — everything is proxied through
 * the api gateway's `/overlay/` surface today, so a separate
 * "streamware app" URL or a separate "asset storage" URL would just be
 * two more names for the same value (an earlier iteration of this API
 * had exactly that split — `streamwareBaseUrl` and
 * `StorageConfig.baseUrl` — and it was a mistake: three settings meant
 * three places to independently misconfigure, for a scenario — assets
 * served from somewhere other than streamware — that isn't built).
 *
 * Lives in the engine's `settings` table under `overlay.publicUrl`
 * (process-wide — not application-scoped); set via
 * `setOverlayPublicUrl`. Falls back to this service's own
 * env-configured `overlayPublicUrl` (`WOOFX3_OVERLAY_PUBLIC_URL`) when
 * no override is configured, and to an empty string beyond that — no
 * further hardcoded guess.
 *
 * `engineSceneOverlayBaseUrl` is a cheap derivation
 * (`${overlayPublicUrl}/overlay/scene`), kept for backward
 * compatibility. Note: as of this writing `/overlay/scene/{id}` isn't
 * wired to a working streamware route — real scene loading goes
 * through the token-based `/overlay/{token}/...` routes instead — so
 * this field's value isn't currently fetchable. Pre-existing gap,
 * tracked separately.
 */
export interface EngineInfo {
  engineSceneOverlayBaseUrl: string;
  overlayPublicUrl: string;
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
 *
 * This is purely about which repository backend barkloader writes
 * bytes to — not where those bytes are publicly reachable from. That's
 * `EngineInfo.overlayPublicUrl` (see its doc comment): everything,
 * including assets, is proxied through the same `/overlay/` surface
 * today regardless of which provider is selected here.
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
   * Set the `overlayPublicUrl` that `getEngineInfo()` returns — the
   * single public base URL for both overlay access and asset
   * resolution (see `EngineInfo`'s doc comment). The operator points
   * this at wherever this api service sits behind a tunnel or reverse
   * proxy. Empty string clears the setting (falls back to the
   * service's own env-configured default, then to an empty string —
   * no further hardcoded guess). Wired to the UI settings form.
   */
  setOverlayPublicUrl(value: string): Promise<{ success: boolean }>;

  /**
   * Read the current storage backend configuration from engine
   * settings — which repository backend barkloader writes bytes to,
   * not where they're publicly reachable from (see `StorageConfig`'s
   * doc comment). Credentials (accessKey/secretKey) are masked or
   * returned blank to the UI — the operator can write new values but
   * cannot read existing ones.
   */
  getStorageConfig(): Promise<StorageConfig>;

  /**
   * Persist storage backend configuration to engine settings, then ask
   * the engine to swap its live Repository. No restart required.
   *
   * `reloaded` reports whether the running engine picked the change up.
   * `success: true, reloaded: false` means the settings are saved but
   * the engine is still serving the previous backend — it was
   * unreachable, or rejected the new configuration as unusable (bad
   * credentials, wrong endpoint, missing bucket). `message` carries the
   * reason.
   */
  setStorageConfig(
    config: StorageConfig,
  ): Promise<{ success: boolean; reloaded?: boolean; message?: string }>;

  // Client Management
  deleteClient(clientId: string): Promise<{ success: boolean; message: string }>;

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

  /**
   * Every `module_resources` row owned by this module that is still referenced
   * by an external workflow, command, or other consumer. Empty when nothing
   * outside the module depends on it. Keyed by composite `moduleKey`.
   */
  checkModuleResourceUsage(moduleKey: string): Promise<ModuleResourceUsage[]>;

  /**
   * Module-level settings declared in the manifest (`settings[]`), registered
   * at install time and read back by sandboxed functions as `ctx.module.settings`.
   * `moduleId` is the manifest-local module id (same id `ctx.module.id`
   * resolves to at runtime), not the composite moduleKey used for install/
   * uninstall. Returns an empty array if the module has no registered
   * settings, not an error.
   */
  getModuleSettings(moduleId: string): Promise<ModuleSettingsResponse>;

  /**
   * `value` must be a string. `valueType` is fixed at install time from the
   * manifest and cannot be changed through this call.
   */
  updateModuleSetting(moduleId: string, key: string, value: string): Promise<ModuleSetting>;

  /**
   * Raw manifest JSON barkloader parsed and stored at install time — the
   * authoritative source for schema-level declarations (`settings[]`,
   * `resources[]`, etc.). `moduleId` is the manifest-local module id, same
   * as `getModuleSettings`/`updateModuleSetting`. Returns null if no module
   * with that id is installed, or its stored manifest fails to parse.
   */
  getModuleManifest(moduleId: string): Promise<Record<string, unknown> | null>;

  /**
   * Creates a runtime instance of a module-declared resource kind (e.g. a
   * user-defined counter — see manifest `resources[]`). `moduleName` is the
   * manifest-local module id, same as `getModuleSettings`. `instanceId` is
   * a caller-chosen manifest-local id; combined with moduleName/kind it
   * forms the canonical id `{moduleName}:{kind}:{instanceId}` that
   * `resource_ref` ConfigField values store. Fires
   * `MODULE_RESOURCE_INSTANCE_CREATED` on success.
   */
  createResourceInstance(
    moduleName: string,
    kind: string,
    instanceId: string,
    displayName: string
  ): Promise<ResourceInstanceDefinition>;

  /**
   * Deletes a resource instance by its canonical id
   * (`{moduleName}:{kind}:{instanceId}`). Fires
   * `MODULE_RESOURCE_INSTANCE_DELETED` on success.
   */
  deleteResourceInstance(canonicalId: string): Promise<void>;

  /**
   * Lists every resource instance across every installed module for this
   * deployment. Backs a periodic full-snapshot reconcile so a consumer's
   * cache can self-heal from the engine's authoritative data instead of
   * relying solely on the create/delete webhooks above.
   */
  listAllResourceInstances(): Promise<ResourceInstanceDefinition[]>;

  /**
   * Resource instances owned by one installed module (keyed by composite
   * `moduleKey`). Used by the module detail RESOURCES tab. Optional
   * `moduleName` is a fallback when the composite key does not match the
   * engine row (e.g. reinstall hash drift).
   */
  listResourceInstancesForModule(
    moduleKey: string,
    moduleName?: string
  ): Promise<ResourceInstanceDefinition[]>;

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
  // command.created / command.updated / command.deleted webhooks on success)
  createCommand(data: CreateCommandInput): Promise<CommandSnapshot>;
  updateCommand(id: string, data: UpdateCommandInput): Promise<CommandSnapshot>;
  deleteCommand(id: string, correlationKey?: string): Promise<{ deleted: boolean }>;
  // Sync — full snapshot list for reconciliation against the Convex mirror
  listCommands(): Promise<CommandSnapshot[]>;

  // Discovery — aggregated module function list for UI dropdowns.
  // Backed by db.listModules(); each module row carries its functions.
  listAvailableFunctions(): Promise<AvailableFunction[]>;

  // Groups ("user groups"/roles) — the only permission concept exposed to
  // the UI. Commands are granted to groups (or specific users, or left
  // "public") via CreateCommandInput/UpdateCommandInput's groupIds/usernames.
  // Emits group.created / group.updated / group.deleted /
  // group.member_added / group.member_removed webhooks on success.
  listGroups(): Promise<GroupSnapshot[]>;
  createGroup(data: CreateGroupInput): Promise<GroupSnapshot>;
  updateGroup(id: string, data: UpdateGroupInput): Promise<GroupSnapshot>;
  deleteGroup(id: string, correlationKey?: string): Promise<{ deleted: boolean }>;
  listGroupMembers(groupId: string): Promise<string[]>;
  addUserToGroup(groupId: string, username: string): Promise<{ ok: true }>;
  removeUserFromGroup(groupId: string, username: string): Promise<{ ok: true }>;
  /** Every group the user belongs to, for rendering a user's effective access. */
  listGroupsForUser(username: string): Promise<GroupSnapshot[]>;

  // Permissions — read-only view of the derived Casbin policy rows. Useful
  // for a debugging/inspection panel; day-to-day management goes through the
  // group and command APIs above, which own these rows.
  listPermissions(query?: ListPermissionsQuery): Promise<PermissionRule[]>;

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
  }): Promise<{
    id: string;
    overlayToken: {
      tokenId: string;
      token: string;
      sceneId: string;
      applicationId: string;
      label: string;
      status: string;
      createdAt: string;
      url: string;
    };
  }>;
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

  // Stream status
  getStreamStatus(accountId: string): Promise<StreamStatus>;

  /**
   * Publish a CloudEvent on the engine's NATS bus. The `eventType` becomes
   * the CloudEvent type and the NATS subject; workflows and modules
   * subscribed to that subject will fire. Used by the UI's Debug Tools
   * page to hand-fire events without a live Twitch session.
   */
  triggerEvent(eventType: string, eventData: Record<string, unknown>): Promise<{ success: boolean; message: string }>;

  // Workflow execution (user-facing)
  triggerWorkflowByName(
    workflowName: string,
    parameters?: Record<string, string>,
    userId?: string
  ): Promise<TriggerWorkflowResponse>;

  // Dashboard
  getDashboardStats(): Promise<DashboardStats>;

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

  // Overlay Tokens
  //
  // Overlay tokens (`ovl_` + base58) are the public identity of a
  // browser-source URL. One token maps to one scene; revoking it
  // invalidates the URL without deleting the scene.

  /** Mint a new overlay token for the given scene. Returns the token and
   *  the browser-source URL (`{overlayPublicUrl}/overlay/{token}/`). The
   *  plaintext token is returned exactly once — store it or mint again. */
  mintOverlayToken(input: {
    sceneId: string;
    label?: string;
  }): Promise<{
    tokenId: string;
    token: string;
    sceneId: string;
    applicationId: string;
    label: string;
    status: string;
    createdAt: string;
    url: string;
  }>;

  /** Tombstone an active token. Revocation sends a P2 `control:
   *  token.revoked` frame to all open overlay sockets and blanks the
   *  browser source without touching the scene. Idempotent. */
  revokeOverlayToken(input: {
    tokenId: string;
  }): Promise<{ tokenId: string; status: string }>;

  /** Atomically revoke the old token and mint a replacement. Returns the
   *  new token + URL. The old token is permanently revoked. */
  rotateOverlayToken(input: {
    tokenId: string;
    label?: string;
  }): Promise<{
    tokenId: string;
    token: string;
    sceneId: string;
    applicationId: string;
    label: string;
    status: string;
    createdAt: string;
    url: string;
  }>;

  /** List all overlay tokens for the authenticated application, optionally
   *  filtered by sceneId. Includes the browser-source URL for each. */
  listOverlayTokens(input?: {
    sceneId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<
    Array<{
      tokenId: string;
      token: string;
      sceneId: string;
      label: string;
      status: string;
      createdAt: string;
      url: string;
    }>
  >;

  /** Forward a widget status report from a scene manager operating in
   *  parent-frame mode (`?eventSource=parent`). Takes `tokenId` — not the
   *  plaintext token — scoped to the caller's applicationId. */
  reportWidgetEvent(input: {
    tokenId: string;
    event: { type: string; [key: string]: unknown };
  }): Promise<{ ok: true }>;
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
