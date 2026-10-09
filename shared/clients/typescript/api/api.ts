// Shared API Types for woofx3 UI and Backend

import type { EngineCapabilities } from "./capabilities";
import type {
  ConfigBundle,
  ConfigExportOptions,
  ConfigImportOptions,
  ConfigImportPlan,
  ConfigImportResult,
} from "./config-bundle";
import type { RegisterClientOptions } from "./rpc";
import type { StreamEventSubscriber } from "./stream-events";
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
  /** Always empty for a `secret` setting; its value never leaves the engine. */
  value: string;
  valueType: string;
  /** Whether a value is stored — the only way to tell for a `secret` setting. */
  isSet?: boolean;
}

export interface ModuleSettingsResponse {
  settings: ModuleSetting[];
}

/** One installed theme a widget's `theme` settings field can select. */
export interface WidgetThemeOption {
  /** Theme canonical id `{moduleId}:theme:{id}` — the value the field stores. */
  id: string;
  name: string;
  description: string;
  /** The module that ships the theme. */
  moduleId: string;
  moduleVersion: string;
  contractVersion: number;
  /**
   * False when the theme no longer fits the widget's current contract (the
   * widget's module was upgraded past it). A frame selecting it renders the
   * widget's defaults, so a picker should not offer it, and should flag it
   * when it is the stored value.
   */
  compatible: boolean;
  previewUrl: string | null;
}

export interface WidgetThemes {
  /** The widget canonical id the list is for. */
  widget: string;
  /** The widget's contract version, or null when it cannot be themed. */
  contractVersion: number | null;
  /** Ordered by name. Empty when nothing installed targets the widget. */
  themes: WidgetThemeOption[];
}

/** One file in an installed module's archive, path relative to the module root (where manifest.json is). */
export interface ModuleFileEntry {
  path: string;
  /** Uncompressed size in bytes. */
  size: number;
}

export interface ModuleFileList {
  /** False when the engine holds no archive for this module (e.g. bundled or legacy installs); files is then []. */
  available: boolean;
  /** Sorted by path, files only (no directory entries). */
  files: ModuleFileEntry[];
}

/** The bytes a `getModuleFile` reads as text at most. */
export const MODULE_FILE_TEXT_LIMIT_BYTES = 1024 * 1024;

/**
 * One file from an installed module, for a read-only viewer. `kind` says
 * whether `content` is present: only for valid UTF-8 with no NUL bytes and
 * no larger than `MODULE_FILE_TEXT_LIMIT_BYTES`.
 */
export type ModuleFileContent =
  | { path: string; size: number; kind: "text"; content: string }
  | { path: string; size: number; kind: "binary" }
  | { path: string; size: number; kind: "too_large" };

/**
 * An inbound HTTP request the control plane relays to a module's webhook
 * handler. See `Woofx3EngineApi.handleInboundWebhook`.
 */
export interface InboundWebhookRequest {
  /** Minted by the control plane per request; the handler's `ctx.event.id`. */
  deliveryId: string;
  method: "GET" | "POST";
  /** Lowercased names; every request header except `cookie`. */
  headers: Record<string, string>;
  /** One value per key (the first occurrence). */
  query: Record<string, string>;
  /** The request body as UTF-8, exactly as received. */
  rawBody: string;
}

/** The response the control plane sends back to the third party, unchanged. */
export interface InboundWebhookResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
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
  isEnabled: boolean;
  definition: WorkflowDefinition | null;
  stats: WorkflowStats;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowsQuery {
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
  limit?: number;
}

/**
 * Whether the engine could load a stored workflow. `"error"` means the saved
 * definition is not running as saved: usually it never fires (unreadable,
 * refused, or its trigger could not be registered), though a refused update
 * can leave an earlier version running.
 */
export type WorkflowHealthStatus = "ok" | "error";

/**
 * One workflow's health, as returned by getWorkflowHealth and carried by the
 * `workflow.health.changed` and `workflow.health.snapshot` webhooks.
 *
 * A workflow with no entry is ok as far as the engine knows: disabled,
 * deleted, and healthy workflows all look the same here. Only an `"error"`
 * entry needs showing.
 */
export interface WorkflowHealth {
  workflowId: string;
  status: WorkflowHealthStatus;
  /** The engine's refusal, verbatim. Present only when status is "error". */
  reason?: string;
  /** ISO 8601. When the current status (and reason) began. */
  since: string;
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
  /**
   * Absent when the dashboard keeps the refresh token itself and the engine
   * asks it for fresh tokens (`twitch.token.requested`).
   */
  refreshToken?: string;
  scope: string[];
  expiresIn: number;
  obtainmentTimestamp: number;
  userId: string;
  /**
   * The Twitch app that issued the token. Present when the token comes from a
   * dashboard: the engine then refreshes through that dashboard rather than
   * with Twitch app credentials of its own.
   */
  clientId?: string;
}

// ==================== Actions ====================

/**
 * One action to run: the same shape a workflow step has, because it is the
 * same thing. `action` names the engine handler (`function`, `alert`,
 * `print`, ...); `function` carries the canonical function id when the
 * handler is `function`; `$ref` records which module action this came from,
 * for the reference graph.
 *
 * Parameters may contain `${trigger.data...}` expressions, resolved against
 * the event the actions run for.
 */
export interface ActionStep {
  /** Defaults to the step's position ("action-1", ...) when omitted. */
  id?: string;
  action: string;
  function?: string;
  parameters?: Record<string, unknown>;
  $ref?: string;
  /** Omit to run after the previous action; `[]` to run alongside it. */
  dependsOn?: string[];
}

/**
 * A request to run actions that belong to no workflow.
 *
 * The run is not recorded and reports no lifecycle: both are keyed by a
 * workflow id, and there is no workflow here. `triggerId` is the caller's own
 * correlation handle, echoed into the engine's logs.
 */
export interface RunActionsInput {
  actions: ActionStep[];
  /** Names the run in the engine's logs, e.g. `command:hug`. */
  label?: string;
  /** What the actions resolve `${trigger.data...}` against. */
  event?: {
    type?: string;
    source?: string;
    data?: Record<string, unknown>;
  };
  triggerId?: string;
}

// ==================== Commands ====================

/** "public" always allows any user; "restricted" requires the invoking user
 * to belong to one of groupIds or be listed in usernames. */
export type CommandVisibility = "public" | "restricted";

/**
 * Snapshot of a chat command as the engine stores it.
 *
 * A command runs `actions`, in order. Replying in chat is an action like any
 * other (`chat.reply`), which is what lets a command do anything a workflow
 * step can. An empty list is a command that only announces itself on
 * `chat.command.<slug>` for workflows to react to.
 */
export interface CommandSnapshot {
  id: string;
  command: string;
  actions: ActionStep[];
  cooldown: number;
  priority: number;
  enabled: boolean;
  visibility: CommandVisibility;
  groupIds: string[];
  usernames: string[];
  /**
   * Optional "{variable}" placeholders declaring named arguments, e.g.
   * "{songTitle}" or "{userA} {userB}" - `command` itself never contains
   * braces, it's always the bare trigger word ("sr", "hug"). The extracted
   * values reach the command's actions on the trigger event, as
   * `${trigger.data.variables.songTitle}`.
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
  actions: ActionStep[];
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
 * The manifest declarations that can hold a field with a request behind it:
 * a trigger's `schema`, an action's `schema`, a widget's `settingsSchema`, a
 * resource kind's `schema`, and the module's `settings`.
 */
export type FieldOptionsDeclaration = "trigger" | "action" | "widget" | "resource" | "setting";

/**
 * Where a field whose options (or button press) the engine answers is
 * declared, in an installed module's manifest. The engine looks the field up
 * and sends the request that manifest declares, so a caller can only ask for
 * a request some installed module declared, never name one.
 *
 * `declarationId` is the trigger, action or widget `id`, or the resource
 * `kind`; a module setting has none, since `settings` is one list per module.
 */
export interface FieldOptionsReference {
  /** Manifest-local module id, the first segment of the module's canonical ids. */
  moduleId: string;
  declaration: FieldOptionsDeclaration;
  declarationId?: string;
  /** The field's `id` within that declaration. */
  fieldId: string;
}

/**
 * One function registered by an installed module. Aggregated across all
 * modules by `listAvailableFunctions`. `qualifiedName` is barkloader's
 * `module/function` lookup path in ModuleRegistry.
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
  actions: ActionStep[];
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
  name: string;
  description: string;
  createdAt: string;
  /**
   * Built-in groups are seeded once for the engine: `everyone`,
   * `subscriber`, `vip`, `moderator`, `broadcaster`. They cannot be renamed
   * or deleted - the engine refuses both, so a UI should render those
   * affordances as disabled rather than relying on the call failing.
   *
   * Membership of all but `everyone` is owned by the platform membership sync
   * and will be overwritten if edited by hand, so member management should be
   * disabled for built-ins too. `everyone` has no membership at all and
   * matches every user implicitly.
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

/**
 * One stored user asset, or a folder holding others.
 *
 * `url` and `thumbnailUrl` are derived rather than stored: the engine
 * keeps repository keys, and the public URL they map to depends on where
 * the overlay gateway is reachable. Both are null for a folder and for a
 * resource whose bytes have not landed yet.
 *
 * A thumbnail never appears as a resource of its own -- it is a field on
 * the resource it was derived from.
 */
export interface Resource {
  id: string;
  name: string;
  /** Containing folder, or null at the root of the tree. */
  parentId: string | null;
  isFolder: boolean;
  /** "image" | "video" | "audio" | "other" | "folder". */
  kind: string;
  /** Empty for folders. */
  contentType: string;
  size: number;
  /** "pending" | "ready" | "failed". Folders are always "ready". */
  status: string;
  url: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResourcesQuery {
  /** Unset lists the root; set lists that folder's direct children. */
  folderId?: string | null;
  kind?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface PaginatedResources {
  resources: Resource[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Permission to upload one object straight to storage.
 *
 * Identical whichever storage backend is configured: on S3 `uploadUrl`
 * is a presigned PUT at the bucket, on local disk it points back at the
 * engine's own token-guarded endpoint. Callers perform one PUT with
 * exactly `headers` and never branch on the provider.
 */
export interface UploadGrant {
  resource: Resource;
  uploadUrl: string;
  method: string;
  headers: Array<{ name: string; value: string }>;
  /** Unix seconds, absolute so callers need not reason about clock skew. */
  expiresAt: number;
}

/** A grant to upload a video's captured frame; it creates no resource of its own. */
export type PosterUploadGrant = Omit<UploadGrant, "resource">;

export interface RequestUploadUrlInput {
  name: string;
  contentType: string;
  parentId?: string | null;
  size?: number;
  ttlSeconds?: number;
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
  widgets: SceneWidget[];
  createdAt: string;
}

export interface ScenesQuery {
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
  /**
   * Platform events -- cheers, follows, subs, gifts, raids, redemptions -- that
   * occurred in the 24 hours before the call. Chat is not counted.
   */
  recentEvents: number;
}

/** One platform event, as the dashboard's activity feed shows it. */
export interface RecentActivity {
  /** The event type, e.g. `channel.cheer`. */
  type: string;
  /** e.g. `twitch`. */
  platform: string;
  /** The viewer's display name. Null for an anonymous cheer or gift. */
  userName: string | null;
  /** Bits, gifted subs, raiders or channel points. Null when the event carries no quantity. */
  amount: number | null;
  /** ISO 8601. When the event happened. */
  timestamp: string;
}

// ==================== OBS ====================

/** The scene manager's connection to OBS. Mirrors ObsConnectionState in sceneManager/src/obs/connection.ts. */
export type ObsConnectionState = "connecting" | "connected" | "retrying" | "stopped";

/** What the dashboard collected when the streamer approved a module's OAuth integration. */
export interface ModuleOAuthAuthorization {
  code: string;
  /** The PKCE verifier the authorize request's challenge was made from. */
  codeVerifier: string;
  /** The redirect URI the authorize request named; the provider checks it matches. */
  redirectUri: string;
  /** The OAuth client to exchange as, when the dashboard supplies the app; otherwise the module's own. */
  clientId?: string;
  /**
   * Required with `clientId`: the token endpoint the dashboard checked when it
   * chose that app. The engine refuses the exchange unless the module's
   * installed `tokenUrl` is still the same.
   */
  tokenUrl?: string;
}

export interface ModuleOAuthConnected {
  connected: true;
  scope: string[];
}

/** Returned by `getSceneEditorSession`. */
export interface SceneEditorSession {
  token: string;
  /** The editor socket, relative to sceneManager's public URL. */
  path: string;
  /** How long `token` may be presented for; ask again to reconnect after. */
  expiresInSeconds: number;
}

/**
 * Outcome of `getObsStatus`.
 *
 * - `state`: the connection's state, or `unanswered` when the scene manager did
 *   not reply, which says nothing about OBS itself.
 * - `failure`: why the last connect attempt failed: `authentication` when OBS
 *   refused the password, `unreachable` when nothing answered at `address` or
 *   the connection was lost. Null while connected and before any attempt failed.
 *   `relay` when the endpoint is routed through the companion and the relay
 *   could not open the bridge (the companion is not connected, or the relay
 *   refused).
 * - `address`: the `host:port` the scene manager last tried. Never includes the
 *   password. Through the companion it is the bridge's host, never a ticket.
 * - `route`: how the last attempt reached OBS: straight to the address in the
 *   module's settings, or through the companion's bridge. Absent before any
 *   attempt, and from engines without the `modules.localEndpoints` capability.
 */
export interface ObsStatus {
  state: ObsConnectionState | "unanswered";
  failure: "authentication" | "unreachable" | "relay" | null;
  address: string | null;
  route?: "direct" | "companion";
}

// ==================== Local endpoints ====================

/** Where a cloud engine reaches the companion's bridge, and which endpoints go through it. */
export interface RelayConfig {
  /** `https://c-xxxxxxxxxxxx.woofx3.tv`; the dialer opens `wss://…/bridge/<moduleId>/<endpointId>`. */
  bridgeOrigin: string;
  endpoints: RelayEndpoint[];
}

/** A module's `local[]` endpoint, named by the module's manifest id and the endpoint's `id`. */
export interface RelayEndpoint {
  moduleId: string;
  endpointId: string;
}

// ==================== Alert queue controls ====================

/**
 * Outcome of `skipCurrentAlert`. `ok` is false only when the request could not
 * act at all (no overlay is open, or the scene manager did not answer), and
 * `reason` then says why. With `ok` true, `skipped` counts the distinct alerts
 * that were playing and were ended; 0 means nothing was playing.
 */
export interface AlertSkipResult {
  ok: boolean;
  skipped: number;
  reason?: string;
}

/**
 * Outcome of `clearAlertQueue`. `cleared` counts the distinct alerts that were
 * waiting to play and were dropped; the alert playing when the request arrived
 * keeps playing. `ok`/`reason` as for `AlertSkipResult`.
 */
export interface AlertClearResult {
  ok: boolean;
  cleared: number;
  reason?: string;
}

/**
 * Outcome of `replayAlert`. With `ok` true the alert was queued on at least
 * one open overlay under the fresh envelope id `replayEnvelopeId`; otherwise
 * `reason` says why it will not play.
 */
export interface AlertReplayResult {
  ok: boolean;
  replayEnvelopeId?: string;
  reason?: string;
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
  /** `"SYSTEM"` marks a module that ships with the engine and cannot be uninstalled. */
  createdByType: string;
  /**
   * Manifest-local module id (`woofx3`, `woofx3_twitch`), the first segment of
   * every canonical id this module owns. Distinct from the display `name`.
   */
  moduleId: string;
  /** Composite `{moduleId}:{version}:{sha7}` the module was installed under. */
  moduleKey: string;
  /**
   * The installed manifest, parsed; null when absent or unparseable.
   *
   * A manifest's `resources[]` is the only declaration of the resource kinds a
   * module provides, and the `module.installed` webhook carries no manifest —
   * so a mirror that never reads this one sees no kinds.
   */
  manifest: Record<string, unknown> | null;
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

/**
 * One online span within a stream session: the stream went live at
 * `startedAt` and went down at `endedAt`. Offline is the gap between
 * segments, not a segment of its own.
 */
export interface StreamSessionSegment {
  id: string;
  /** ISO 8601. When the stream went live. */
  startedAt: string;
  /** ISO 8601. When the stream went down; null while it is still live. */
  endedAt: string | null;
}

/**
 * The logical span a broadcast belongs to. A session can cover several
 * online/offline cycles, and can be entirely offline, so whether and when the
 * stream was live is read from `segments`, not from the session's own times.
 *
 * Splits and merges move segments between sessions, so an id cached from an
 * earlier read may no longer exist.
 */
export interface StreamSession {
  id: string;
  /** `open` for the session events are being stamped with; at most one is. */
  status: "open" | "closed";
  /** ISO 8601. When the session began, which may predate its first segment. */
  startedAt: string;
  /** ISO 8601. When a later session replaced this one; null while open. */
  endedAt: string | null;
  /**
   * Oldest first. Empty means the session has never been live, which is a
   * different fact from "went offline long ago".
   */
  segments: StreamSessionSegment[];
}

export interface StreamSessionsQuery {
  /** Page size, 1-200. Defaults to 50. */
  limit?: number;
  /** Sessions to skip, newest first. Defaults to 0. */
  offset?: number;
}

/**
 * A page of sessions, newest first. The list is not append-only (a split
 * inserts a session and a merge removes one), so offset paging can skip or
 * repeat a session that changed between pages.
 */
export interface PaginatedStreamSessions {
  sessions: StreamSession[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * What a stream session added up to. Events count toward the session that
 * owns the time they occurred in -- from the session's start until the one
 * that replaced it began -- so a split or merge after the fact is reflected
 * on the next read. Anonymous cheers and gifts are included.
 */
export interface StreamSessionTotals {
  sessionId: string;
  /** Bits cheered. */
  bits: number;
  cheers: number;
  /**
   * Subscriptions viewers took out or renewed themselves: new subs that were
   * not gifted, plus resubs. Gifted subs are only in `giftedSubs`, so the two
   * add up without counting a gift twice.
   */
  subs: number;
  /** Subs gifted, counted from the gifter's side. */
  giftedSubs: number;
  follows: number;
  raids: number;
  /** Viewers brought by those raids. */
  raiders: number;
  /**
   * Highest per-minute viewer count while live. Null when no minute of the
   * session was sampled with a viewer count.
   */
  peakViewers: number | null;
  /** Mean of the sampled per-minute viewer counts, rounded. Null as above. */
  averageViewers: number | null;
  /** Minutes sampled with a viewer count; what the two figures above cover. */
  viewerSampleMinutes: number;
}

export interface ViewerTotalsQuery {
  /** e.g. `twitch`. */
  platform: string;
  /** The viewer's id on `platform`. */
  platformUserId: string;
  /** Totals for one session. Omit for the viewer's lifetime totals. */
  sessionId?: string;
}

/** What one viewer gave. Anonymous cheers and gifts are never attributed. */
export interface ViewerTotals {
  platform: string;
  platformUserId: string;
  /** The name on the viewer's most recent event; null when none carried one. */
  userName: string | null;
  /** The session the totals cover; null for lifetime. */
  sessionId: string | null;
  bits: number;
  cheers: number;
  giftedSubs: number;
  /** Gift events: one community gift of five subs is one gift. */
  gifts: number;
}

export type LeaderboardMetric = "bits" | "giftedSubs";

export interface LeaderboardQuery {
  metric: LeaderboardMetric;
  /** Rank one session. Omit for a lifetime leaderboard. */
  sessionId?: string;
  /** Keep viewers whose total is at least this, e.g. "gifted 5 or more". Integer >= 1; defaults to 1. */
  minTotal?: number;
  /** 1-100. Defaults to 10. */
  limit?: number;
}

export interface LeaderboardEntry {
  platform: string;
  platformUserId: string;
  /** The name on the viewer's most recent event; null when none carried one. */
  userName: string | null;
  /** Bits, or subs gifted. */
  total: number;
  /** The events behind `total`: cheers, or gifts. */
  events: number;
}

export interface Leaderboard {
  metric: LeaderboardMetric;
  /** The session ranked; null for lifetime. */
  sessionId: string | null;
  minTotal: number;
  /** Highest total first; ties by platform, then platform user id. */
  entries: LeaderboardEntry[];
}

/**
 * One sampled minute of a live segment. A minute with no entry was not
 * sampled, which is not the same as zero; a null metric is one whose read
 * failed that minute.
 */
export interface StreamGaugeSample {
  /** ISO 8601, truncated to the minute. */
  sampledAt: string;
  viewerCount: number | null;
  followerTotal: number | null;
  subscriberTotal: number | null;
  subscriberPoints: number | null;
}

/**
 * Optional behaviour for `triggerWorkflowByName`.
 *
 * Supplying `triggerData` or `dryRun` makes the call wait for the engine to
 * answer, so the response says whether the run started and with which
 * execution id.
 */
export interface TriggerWorkflowOptions {
  /**
   * Sample payload for the run's trigger. The run starts from an event of the
   * workflow's own trigger type with this as its data, so `${trigger.data...}`
   * resolves exactly as it would for a real event, and the trigger's
   * conditions are evaluated against it. Only the named workflow runs: no
   * other workflow listening for the same event sees it. At most
   * `MAX_TRIGGER_DATA_BYTES` as JSON.
   */
  triggerData?: Record<string, unknown>;
  /** The sample event's platform ("twitch", ...), for `${trigger.platform}` conditions. */
  platform?: string;
  /**
   * Run even when `triggerData` does not satisfy the trigger conditions.
   * Default false: an unmatched sample is answered with `conditions_not_met`
   * and the unmet conditions, which is how a creator tests the "doesn't
   * match" path.
   */
  skipConditions?: boolean;
  /**
   * What started the run ("test", "dashboard", ...), recorded as its
   * `triggeredBy`. The same value the positional `triggeredBy` carries; give
   * one or the other, or the same value in both.
   */
  origin?: string;
  /**
   * Run without side effects. The engine decides what that means, never the
   * workflow's modules:
   * - actions that change something (chat, alerts, published events, module
   *   functions, and any action not declared side-effect free) are not called;
   *   each step records `{ dryRun: true, wouldDo: "<sentence>" }` instead.
   *   Parameters the real action would refuse still fail the step.
   * - waits complete at once, recording what they would have waited for.
   * The run is recorded with `dryRun: true` (see `WorkflowRunSnapshot`), and a
   * replay of it is a dry run too. A later step that reads a skipped step's
   * real output fails to resolve.
   */
  dryRun?: boolean;
}

/** Most bytes `TriggerWorkflowOptions.triggerData` may encode to as JSON. */
export const MAX_TRIGGER_DATA_BYTES = 16 * 1024;

/** A trigger condition a sample payload did not satisfy. */
export interface UnmetTriggerCondition {
  field: string;
  operator: string;
  value: unknown;
  /** Set when the condition could not be evaluated, e.g. an unknown operator. */
  error?: string;
}

export interface TriggerWorkflowResponse {
  /**
   * The engine's id for the run, when the engine answered: set for `started`.
   * Empty for `requested` -- a published request is started asynchronously
   * after this call has returned, so correlate on `triggerId` instead; it is
   * the id the run's lifecycle is reported against.
   */
  executionId: string;
  /**
   * `requested`: published without waiting for the engine (no options given).
   * `started`: the engine began the run.
   * `conditions_not_met`: `triggerData` failed the trigger conditions and no
   * run started; see `unmetConditions`.
   */
  status: "requested" | "started" | "conditions_not_met";
  message: string;
  /** Correlation handle for the requested run. See `executionId`. */
  triggerId: string;
  /** The event type the run started from; set when the engine answered. */
  eventType?: string;
  /** Every condition the sample failed; set for `conditions_not_met`. */
  unmetConditions?: UnmetTriggerCondition[];
  /** True when the run started is a dry run. */
  dryRun?: boolean;
}

/** What `cancelWorkflow` did. */
export interface CancelWorkflowResult {
  executionId: string;
  /**
   * `cancelled`: the run was stopped, or already had been by an earlier
   * cancel. `already_finished`: it had completed or failed first, and is
   * unchanged.
   */
  outcome: "cancelled" | "already_finished";
  /** The run's status after the call: "cancelled", or the status it finished with. */
  status: string;
  message: string;
}

// ==================== API Interface ====================

/** RPC connectivity check; mirrors `GET /health` semantics. */
export type PingResponse = { status: "ok" };

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
    options: RegisterClientOptions
  ): Promise<{ clientId: string; clientSecret: string }>;
}

/**
 * Deployment-level information the UI needs to construct URLs.
 * Returned by `getEngineInfo()` — typically called once per UI
 * session and cached.
 *
 * Lives in the engine's `settings` table under `overlay.publicUrl`; set via
 * `setOverlayPublicUrl`. Falls back to the engine's configured
 * `sceneManagerUrl` when no override is configured.
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
  /** The release this engine runs (its image tag), or "dev" for an unversioned build. */
  version: string;
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
   * The capability ids this engine supports (see `ENGINE_CAPABILITIES` and
   * docs/services/engine-capabilities.md). Clients gate newer features on
   * these ids rather than on the engine version, which is an image tag. An
   * engine without this method predates capabilities and supports none.
   */
  getEngineCapabilities(): Promise<EngineCapabilities>;

  /**
   * Set the `overlayPublicUrl` that `getEngineInfo()` returns — the
   * single public base URL for both overlay access and asset
   * resolution (see `EngineInfo`'s doc comment). The operator points
   * this at wherever this api service sits behind a tunnel or reverse
   * proxy. Empty string clears the setting (falls back to the
   * configured `sceneManagerUrl`). Wired to the UI settings form.
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
  setStorageConfig(config: StorageConfig): Promise<{ success: boolean; reloaded?: boolean; message?: string }>;

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
   * Every file in the archive an installed module was installed from:
   * functions, widget files, themes, the manifest, the README. Paths are
   * relative to the module root, the directory holding the manifest.
   * `moduleId` is the manifest-local module id, same as `getModuleManifest`.
   * `available` is false when the engine kept no archive for the module.
   * Throws when no module with that id is installed.
   */
  listModuleFiles(moduleId: string): Promise<ModuleFileList>;

  /**
   * One file from `listModuleFiles`, classified for a read-only viewer: text
   * with its content, or `binary` / `too_large` without it. Throws
   * `file not found in module: <path>` when the module has no such file, and
   * when no module with that id is installed.
   */
  getModuleFile(moduleId: string, path: string): Promise<ModuleFileContent>;

  /**
   * The installed themes made for one widget, for the picker behind a
   * `theme` settings field. `widgetCanonicalId` is `{moduleId}:widget:{id}`.
   * Themes come and go only with module installs, so a picker refreshes on
   * `module.installed` and `module.deleted`.
   */
  listWidgetThemes(widgetCanonicalId: string): Promise<WidgetThemes>;

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
    displayName: string,
    /** Values for the kind's `schema` fields. Kept verbatim; the owning module reads them. */
    settings?: Record<string, unknown>
  ): Promise<ResourceInstanceDefinition>;

  /**
   * The current value of each resource instance, keyed by canonical id; `null`
   * for an instance that holds nothing yet (or whose session value was cleared).
   *
   * An instance's value lives in its owning module's storage at
   * `state:<canonicalId>` — the convention every resource kind follows (see
   * docs/barkloader/modules.md), and the key a module updates.
   */
  getResourceValues(canonicalIds: string[]): Promise<Record<string, unknown>>;

  /**
   * Renames an instance or replaces the settings it runs with. Identity is
   * fixed, so everything referencing it keeps working. Fires
   * `MODULE_RESOURCE_INSTANCE_UPDATED` on success.
   */
  updateResourceInstance(
    canonicalId: string,
    displayName: string,
    settings?: Record<string, unknown>
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
  listResourceInstancesForModule(moduleKey: string, moduleName?: string): Promise<ResourceInstanceDefinition[]>;

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
  /**
   * Health of every enabled workflow the engine has loaded. Authoritative:
   * a client replaces its whole view with the answer, and any workflow not
   * listed with `"error"` is ok. Answered live by the workflow service, so it
   * reflects the engine now rather than the last webhook received. Rejects
   * while the engine is still loading its workflows, when the list would be
   * partial.
   */
  getWorkflowHealth(): Promise<WorkflowHealth[]>;

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

  // Generic user assets. Bytes never pass through the engine: callers
  // ask for a grant, PUT straight to storage, then report completion.
  requestUploadUrl(input: RequestUploadUrlInput): Promise<UploadGrant>;
  completeUpload(resourceId: string, size?: number): Promise<Resource>;
  // The engine decodes no video: a video's thumbnail comes from a frame
  // the caller captures and PUTs to this grant before requestProcessing.
  requestPosterUploadUrl(resourceId: string, contentType: string, ttlSeconds?: number): Promise<PosterUploadGrant>;
  createFolder(name: string, parentId?: string | null): Promise<Resource>;
  getResource(id: string): Promise<Resource>;
  listResources(query?: ResourcesQuery): Promise<PaginatedResources>;
  updateResource(id: string, changes: { name?: string; parentId?: string | null }): Promise<Resource>;
  deleteResource(id: string): Promise<{ deleted: boolean }>;
  // Asynchronous. Completion lands on the resource as `thumbnailUrl`;
  // a resource the utility cannot apply to (audio has no frame to
  // render, nor does a video with no poster uploaded) simply keeps a
  // null thumbnail rather than failing.
  requestProcessing(resourceId: string, utility?: string): Promise<{ accepted: boolean }>;

  // Twitch token persistence — bridges the UI's OAuth callback to the
  // engine's bootstrap, which reads `twitch_token` from db settings.
  // `convexUserId` (optional) gets resolved to an engine-side user UUID
  // and stored on settings.user_id so the row is properly user-scoped.
  setTwitchToken(token: TwitchAccessToken, convexUserId?: string): Promise<{ ok: true }>;
  deleteTwitchToken(): Promise<{ ok: true }>;

  // Generic dynamic-options dispatch. The caller names the field; the engine
  // reads the request that field declares from the installed manifest, fires
  // it over NATS and forwards the reply via webhook ENGINE_RESPONSE_RECEIVED.
  // Returns once the field is resolved, before the reply arrives. An unknown
  // field, or a request descriptor in place of a reference, is refused.
  dispatchFieldOptionsRequest(
    reference: FieldOptionsReference,
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
      surfaces: string[];
      hostsSurface: string;
      taxonomy: string[];
      /** Transition types the widget plays on its own content. */
      transitions: Array<{ id: string; label: string }>;
      createdByType: string;
      createdByRef: string;
    }>;
  }>;

  createScene(data: {
    name: string;
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
  /** The broadcaster's live state. Single-broadcaster per deployment, so
   *  this takes no scope -- the parameter it used to accept was documented
   *  as unused and ignored. */
  getStreamStatus(): Promise<StreamStatus>;

  // Stream sessions
  /** Past and current stream sessions with their segments, newest first. */
  listStreamSessions(query?: StreamSessionsQuery): Promise<PaginatedStreamSessions>;
  /** One session with its segments, or null when no session has that id. */
  getStreamSession(id: string): Promise<StreamSession | null>;

  // Analytics
  /** A session's channel totals and viewer figures, or null when no session has that id. */
  getStreamSessionTotals(sessionId: string): Promise<StreamSessionTotals | null>;
  /** One viewer's totals for a session or lifetime, or null when the session does not exist. */
  getViewerTotals(query: ViewerTotalsQuery): Promise<ViewerTotals | null>;
  /** Top cheerers or gifters for a session or lifetime, or null when the session does not exist. */
  getLeaderboard(query: LeaderboardQuery): Promise<Leaderboard | null>;
  /** A session's per-minute gauge samples, oldest first, or null when no session has that id. */
  getStreamSessionGauges(sessionId: string): Promise<StreamGaugeSample[] | null>;

  /**
   * Publish a CloudEvent on the engine's NATS bus. The `eventType` becomes
   * the CloudEvent type and the NATS subject; workflows and modules
   * subscribed to that subject will fire. Used by the UI's Debug Tools
   * page to hand-fire events without a live Twitch session.
   *
   * `success` means the event reached the bus and nothing more -- whether a
   * workflow matched it, and how that run ended, is decided afterwards in
   * another process. A caller that needs to know supplies `triggerId`: the
   * engine echoes it onto the `workflow.run.*` events it emits, which is what
   * lets the outcome find its way back. `triggeredBy` names the origin
   * ("dashboard", ...) for display.
   */
  triggerEvent(
    eventType: string,
    eventData: Record<string, unknown>,
    triggerId?: string,
    triggeredBy?: string
  ): Promise<{ success: boolean; message: string }>;

  /**
   * Run a module's webhook handler on an inbound request the control plane
   * relayed. `triggerId` is the webhook trigger's canonical id,
   * `{moduleId}:trigger:{triggerId}`. The engine checks the handler's result
   * and publishes its events before returning. The response is the
   * handler's own, or the status the engine chose when it could not run or
   * accept the handler: 404, 500, 503 or 504.
   */
  handleInboundWebhook(triggerId: string, request: InboundWebhookRequest): Promise<InboundWebhookResponse>;

  // Workflow execution (user-facing)
  /**
   * Ask the engine to run one workflow, matched by id or by name.
   *
   * Without `options` this returns once the request is on the bus, not once
   * the run finishes. With them it waits for the engine to begin the run (or
   * refuse it) and returns its execution id; see `TriggerWorkflowOptions`.
   * Either way, supply `triggerId` to be told how that run ended: the engine
   * echoes it onto the `workflow.run.*` events it emits. `userId` is recorded
   * as provenance only and may be any string.
   */
  triggerWorkflowByName(
    workflowNameOrId: string,
    parameters?: Record<string, string>,
    userId?: string,
    triggerId?: string,
    triggeredBy?: string,
    options?: TriggerWorkflowOptions
  ): Promise<TriggerWorkflowResponse>;

  /**
   * Run a list of actions now, without a workflow to hang them on.
   *
   * The actions run in the order given, through the same executor and action
   * handlers a workflow uses, so anything a workflow step can do is available
   * here. Returns once the request is on the bus: the run happens in the
   * workflow engine, asynchronously, and is not recorded.
   */
  runActions(input: RunActionsInput): Promise<{ requested: true; triggerId: string }>;

  /**
   * Run a recorded workflow run again, whole or from `fromTaskId`.
   *
   * Returns once the request is on the bus. The replay's progress -- or the
   * engine's reason for refusing it -- is reported against `triggerId` on the
   * `workflow.run.*` events.
   */
  replayWorkflowRun(
    engineRunId: string,
    fromTaskId?: string,
    triggerId?: string,
    triggeredBy?: string
  ): Promise<{ triggerId: string }>;

  // Dashboard
  getDashboardStats(): Promise<DashboardStats>;

  // Alert queue controls. Alerts queue and play in each open overlay; the
  // scene manager carries these requests to every overlay that is open.

  /**
   * Play a recorded alert again. Re-dispatches the stored envelope under a
   * fresh envelope id, recorded as a new alert-log row, and marks the original
   * row `replayed`. Asking again for the same row while that replay is under
   * way, or within 30 s of it succeeding, returns the same result and plays
   * nothing, so a retry after a timeout cannot play the alert twice.
   */
  replayAlert(id: string): Promise<AlertReplayResult>;

  /**
   * End the alert playing on every open overlay now, mark it `skipped`, and
   * let the next queued alert start.
   */
  skipCurrentAlert(): Promise<AlertSkipResult>;

  /**
   * Drop every alert waiting to play on every open overlay and mark each
   * `skipped`. The alert playing now keeps playing; pair with
   * `skipCurrentAlert` to stop everything.
   */
  clearAlertQueue(): Promise<AlertClearResult>;

  /**
   * How the scene manager's connection to OBS is doing, for the OBS module's
   * page. Requires the `obs.status` capability.
   */
  getObsStatus(): Promise<ObsStatus>;
  /**
   * What the dashboard's scene editor needs to open sceneManager's editor
   * socket for a scene: a token presented once, as `?token=`, on the socket
   * at `path` (relative to sceneManager's public URL). Null when the scene
   * does not exist or sceneManager does not answer. Requires the
   * `scenes.editorSessions` capability.
   */
  getSceneEditorSession(sceneId: string): Promise<SceneEditorSession | null>;

  /**
   * Finish connecting a module's OAuth integration (the manifest's `oauth[]`):
   * the engine exchanges the code the dashboard collected and keeps the
   * tokens where module code cannot read them, for `ctx.oauth.request`.
   * Answers with the scopes granted, never a token. Requires the
   * `modules.oauth` capability.
   */
  completeModuleOAuth(
    moduleId: string,
    integration: string,
    authorization: ModuleOAuthAuthorization
  ): Promise<ModuleOAuthConnected>;

  /**
   * Route the listed local endpoints through the companion's bridge, or stop
   * (null). Stored, so a restart keeps it. The bridge credential is not part
   * of it: the engine asks the dashboard that called this for one with the
   * `relay.credential.requested` request. Requires the
   * `modules.localEndpoints` capability.
   */
  setRelayConfig(config: RelayConfig | null): Promise<{ ok: true }>;

  // Overlay Tokens
  //
  // Overlay tokens (`ovl_` + base58) are the public identity of a
  // browser-source URL. One token maps to one scene; revoking it
  // invalidates the URL without deleting the scene.

  /** Mint a new overlay token for the given scene. Returns the token and
   *  the browser-source URL (`{overlayPublicUrl}/overlay/{token}/`). The
   *  plaintext token is returned exactly once — store it or mint again. */
  mintOverlayToken(input: { sceneId: string; label?: string }): Promise<{
    tokenId: string;
    token: string;
    sceneId: string;
    label: string;
    status: string;
    createdAt: string;
    url: string;
  }>;

  /** Tombstone an active token. Revocation sends a P2 `control:
   *  token.revoked` frame to all open overlay sockets and blanks the
   *  browser source without touching the scene. Idempotent. */
  revokeOverlayToken(input: { tokenId: string }): Promise<{ tokenId: string; status: string }>;

  /** Atomically revoke the old token and mint a replacement. Returns the
   *  new token + URL. The old token is permanently revoked. */
  rotateOverlayToken(input: { tokenId: string; label?: string }): Promise<{
    tokenId: string;
    token: string;
    sceneId: string;
    label: string;
    status: string;
    createdAt: string;
    url: string;
  }>;

  /** List all overlay tokens, optionally filtered by sceneId. Includes the browser-source URL for each. */
  listOverlayTokens(input?: { sceneId?: string; page?: number; pageSize?: number }): Promise<
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
  // ==================== Engine-side operations ====================
  //
  // These are implemented by the engine and reachable over capnweb, but were
  // never declared here. Declaring them makes this contract describe what the
  // engine actually offers -- `api-session.ts` now derives the exposed surface
  // from these keys, so an undeclared method is no longer callable.

  /** Run a chat command as though `username` typed `!<commandName> <text>`
   *  in chat: `text` is parsed into args and `argumentPattern` variables the
   *  same way, the command's actions run, and `chat.command.<slug>` fires for
   *  workflows. Authorization is enforced by db-proxy when it resolves the
   *  command, so a caller without permission is refused rather than silently
   *  ignored. Cooldown is not applied. */
  executeCommand(commandName: string, username: string, text?: string): Promise<{ success: boolean; message: string }>;

  /** Commands a caller may run. The username parameter is accepted but not
   *  yet used to filter the list. */
  getAvailableCommands(username?: string): Promise<{
    commands: Array<{
      id: string;
      name: string;
      /** How many actions it runs. The actions themselves are on listCommands. */
      actions: number;
      cooldown: number;
      enabled: boolean;
    }>;
  }>;

  /**
   * Workflow counts and a recent-activity feed, for a dashboard landing view.
   * `recentActivity` is the latest platform events of the last 24 hours,
   * newest first, at most 20; empty when nothing happened in that span.
   */
  getDashboard(): Promise<{
    workflows: { total: number; enabled: number; running: number };
    recentActivity: RecentActivity[];
  }>;

  getAvailableWorkflows(): Promise<{
    workflows: Array<{
      id: string;
      name: string;
      description: string;
      enabled: boolean;
      lastExecution?: { id: string; status: string; startedAt: string };
    }>;
  }>;

  getWorkflowStatus(executionId: string): Promise<{
    id: string;
    workflowId: string;
    workflowName: string;
    status: string;
    /** 0-100. */
    progress: number;
    startedAt: string;
    completedAt?: string;
    error?: string;
    steps: Array<{
      name: string;
      status: string;
      startedAt?: string;
      completedAt?: string;
    }>;
  }>;

  getWorkflowHistory(options: { workflowName?: string; userId?: string; status?: string; limit?: number }): Promise<{
    executions: Array<{
      id: string;
      workflowName: string;
      status: string;
      startedAt: string;
      completedAt?: string;
      startedBy: string;
    }>;
  }>;

  /**
   * Stop a run. The engine stops waiting for the step in flight (its effect,
   * if already sent, stands), drops any pending wait, and settles the run
   * `cancelled`, which reaches the history as a `workflow.run.updated`
   * webhook and a caller watching its `triggerId` as `workflow.run.cancelled`.
   * Idempotent. Throws for an id no run has.
   */
  cancelWorkflow(executionId: string, reason?: string): Promise<CancelWorkflowResult>;

  /** Push trigger-catalog changes to the caller. The callback is a capnweb
   *  stub, so it stays live for the duration of the session. */
  subscribeTriggerChanges(callback: {
    onTriggerChange(event: { type: string; moduleName: string }): Promise<void>;
  }): Promise<void>;

  /** Push live stream events -- follows, subs, cheers, raids, stream on/off,
   *  ad breaks (upcoming, begin, end) -- to the caller for the life of the
   *  session. Chat is deliberately not on
   *  this channel; see ./stream-events.
   *
   *  Delivery is not gapless: nothing buffers events behind this, so a client
   *  that connects late or reconnects has missed the gap and should re-read
   *  point-in-time state rather than assume a continuous stream. */
  subscribeStreamEvents(callback: StreamEventSubscriber): Promise<void>;

  getUserProfile(userId: string): Promise<{
    id: string;
    username: string;
    treats: { total: number; points: number };
    stats?: Record<string, unknown>;
  }>;

  awardTreatsToUser(
    userId: string,
    treatType: string,
    title: string,
    description: string,
    points: number,
    awardedBy: string,
    imageUrl?: string,
    expiresInDays?: number
  ): Promise<{ success: boolean; message: string }>;

  /** Inject a synthetic Twitch event onto the bus. Intended for development
   *  and for exercising alert overlays without a live stream.
   *
   *  `triggerId` and `triggeredBy` behave exactly as on `triggerEvent`: supply
   *  a triggerId to be told how the resulting run ended, since this call's own
   *  result only reports that the event was published. */
  simulateTwitchEvent(
    eventType: string,
    eventData: Record<string, unknown>,
    triggerId?: string,
    triggeredBy?: string
  ): Promise<{ success: boolean; message: string }>;

  // ==================== Config bundles ====================
  // Backup, move and share a creator's configuration. Format and import rules:
  // docs/services/config-bundles.md.

  /**
   * The creator's workflows, chat commands, command groups and module
   * resource instances as a versioned bundle. Secrets, tokens, module
   * settings and live resource values are never included; group members and
   * per-user command grants only with `includeMembers`.
   */
  exportConfig(options?: ConfigExportOptions): Promise<ConfigBundle>;

  /**
   * What `importConfig` would do with `bundle` under the same options,
   * without writing anything. Throws when the bundle is malformed, too large,
   * or of an unsupported version.
   */
  previewImport(bundle: ConfigBundle, options?: ConfigImportOptions): Promise<ConfigImportPlan>;

  /**
   * Apply `bundle` through the same paths a save in the UI takes, so every
   * item is validated and announced by the usual webhooks. Re-plans against
   * the engine's current state rather than trusting an earlier preview.
   * Best-effort per item: the result reports each item's outcome.
   */
  importConfig(bundle: ConfigBundle, options?: ConfigImportOptions): Promise<ConfigImportResult>;
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
