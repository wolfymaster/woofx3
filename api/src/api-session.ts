import type {
  ConfigBundle,
  ConfigImportOptions,
  EngineEventSubscribeOptions,
  EngineEventSubscriber,
  EngineRequestAnswer,
  MarketplaceInstallRequest,
  RelayConfig,
  StreamEventSubscriber,
  TwitchAccessToken,
  Woofx3EngineApi,
} from "@woofx3/api";
import type { DecidePairingRequest } from "@woofx3/api/pairing";
import { RpcTarget } from "capnweb";
import type { Api } from "./api";
import type { SessionLease } from "./client-sessions";

/**
 * Per-connection session wrapper around the shared Api instance.
 * Carries the authenticated clientId so individual RPC methods
 * can identify the caller without requiring it as a parameter.
 *
 * Methods that need the clientId (e.g. installModuleZip) are overridden
 * to inject it automatically. All other method calls are forwarded to
 * the underlying Api instance via prototype delegation. Every method,
 * overridden or delegated, first checks the session's lease, so a session
 * whose client was deleted refuses every call.
 */
export class ApiSession extends RpcTarget {
  readonly clientId: string;
  private api: Api;
  private lease: SessionLease;

  constructor(api: Api, clientId: string, lease: SessionLease) {
    super();
    this.api = api;
    this.clientId = clientId;
    this.lease = lease;
  }

  /**
   * Throws once the session's client is revoked. Static, so capnweb never
   * serves it, for the prototype methods installed below the class body.
   */
  static assertLive(session: ApiSession): void {
    session.lease.assertLive();
  }

  /**
   * capnweb calls this once the client has released its last stub of the
   * session, so the session is forgotten, and the subscriptions it made end,
   * without waiting for the connection to end. Symbol-keyed, so it is not
   * served.
   */
  [Symbol.dispose](): void {
    this.lease.release();
    this.api.dropSessionSubscriptions(this);
  }

  async installModuleZip(fileName: string, zipBase64: string, context?: { moduleKey?: string }) {
    return this.api.installModuleZip(fileName, zipBase64, {
      clientId: this.clientId,
      moduleKey: context?.moduleKey,
    });
  }

  async installModuleFromUrl(
    downloadUrl: string,
    moduleKey: string,
    ctx: {
      name: string;
      version: string;
      source: "marketplace";
      marketplaceModuleId: string;
    }
  ) {
    return this.api.installModuleFromUrl(downloadUrl, moduleKey, {
      clientId: this.clientId,
      moduleKey,
      ...ctx,
    });
  }

  async installMarketplaceListing(listingId: string, request: MarketplaceInstallRequest) {
    return this.api.installMarketplaceListing(listingId, request, { clientId: this.clientId });
  }

  async setTwitchToken(token: TwitchAccessToken, convexUserId?: string) {
    return this.api.setTwitchToken(token, convexUserId, { clientId: this.clientId });
  }

  /** The session is the registration's key, so a second call replaces the first. */
  async subscribeStreamEvents(callback: StreamEventSubscriber, types?: string[]) {
    return this.api.subscribeStreamEvents(callback, types, { session: this, clientId: this.clientId });
  }

  /** The session supplies the deciding client, for the log. */
  async decidePairing(request: DecidePairingRequest) {
    return this.api.decidePairing(request, { clientId: this.clientId });
  }

  /** Keyed on the session, so revoking its client ends it. */
  async subscribeTriggerChanges(callback: {
    onTriggerChange(event: { type: string; moduleName: string }): Promise<void>;
  }) {
    return this.api.subscribeTriggerChanges(callback, { session: this, clientId: this.clientId });
  }

  /** Keyed on the session like `subscribeStreamEvents`; the client id decides what it receives. */
  async subscribeEngineEvents(callback: EngineEventSubscriber, options?: EngineEventSubscribeOptions) {
    return this.api.subscribeEngineEvents(callback, options, { session: this, clientId: this.clientId });
  }

  /** A client answers only the requests sent to it, so the session supplies its client id. */
  async answerEngineRequest(requestId: string, answer: EngineRequestAnswer) {
    return this.api.answerEngineRequest(requestId, answer, { clientId: this.clientId });
  }

  async setRelayConfig(config: RelayConfig | null) {
    return this.api.setRelayConfig(config, { clientId: this.clientId });
  }

  async uninstallModule(moduleKey: string) {
    return this.api.uninstallModule(moduleKey, {
      clientId: this.clientId,
    });
  }

  async uninstallEngineModule(name: string, context?: { moduleKey?: string }) {
    return this.api.uninstallEngineModule(name, {
      clientId: this.clientId,
      moduleKey: context?.moduleKey,
    });
  }

  async createResourceInstance(
    moduleName: string,
    kind: string,
    instanceId: string,
    displayName: string,
    settings: Record<string, unknown> = {}
  ) {
    return this.api.createResourceInstance(moduleName, kind, instanceId, displayName, settings, {
      clientId: this.clientId,
    });
  }

  async updateResourceInstance(canonicalId: string, displayName: string, settings: Record<string, unknown> = {}) {
    return this.api.updateResourceInstance(canonicalId, displayName, settings, {
      clientId: this.clientId,
    });
  }

  async importConfig(bundle: ConfigBundle, options?: ConfigImportOptions) {
    return this.api.importConfig(bundle, options, {
      clientId: this.clientId,
    });
  }

  async deleteResourceInstance(canonicalId: string) {
    return this.api.deleteResourceInstance(canonicalId, {
      clientId: this.clientId,
    });
  }
}

/**
 * The methods a client may call.
 *
 * Delegation used to copy every function it found on `Api.prototype`, which
 * published whatever happened to be there, including `initSubscriptions`
 * (re-subscribes NATS subjects, and duplicates them on a second call) and
 * `handleProcessingCallback` (which `http.ts` deliberately keeps off the
 * capnweb surface). Nothing declared the
 * boundary, so nothing could hold it.
 *
 * This list is that boundary. The assertion below fails to compile if it
 * drifts from the contract in either direction, so a new route method is
 * unreachable until it is declared -- and a method removed from the contract
 * stops being served. Internal wiring is simply absent from the list and
 * therefore never delegated.
 */
export const RPC_METHODS = [
  "ping",
  "getEngineInfo",
  "getEngineCapabilities",
  "setOverlayPublicUrl",
  "getStorageConfig",
  "setStorageConfig",
  "deleteClient",
  "getModules",
  "getModule",
  "installModuleZip",
  "installModuleFromUrl",
  "installMarketplaceListing",
  "inspectMarketplaceListing",
  "installMarketplaceBundle",
  "marketplaceSearch",
  "marketplaceCounts",
  "marketplaceGetListing",
  "marketplaceGetAuthor",
  "marketplaceQuote",
  "listEngineModules",
  "uninstallModule",
  "uninstallEngineModule",
  "checkModuleResourceUsage",
  "getModuleSettings",
  "updateModuleSetting",
  "getModuleManifest",
  "listModuleFiles",
  "getModuleFile",
  "getModuleStorageUsage",
  "listWidgetThemes",
  "createResourceInstance",
  "updateResourceInstance",
  "getResourceValues",
  "deleteResourceInstance",
  "listAllResourceInstances",
  "listResourceInstancesForModule",
  "listResourceKinds",
  "getTriggers",
  "getActions",
  "getWorkflowCatalog",
  "getWorkflows",
  "getWorkflow",
  "createWorkflow",
  "updateWorkflow",
  "deleteWorkflow",
  "setWorkflowEnabled",
  "getWorkflowRuns",
  "getWorkflowRun",
  "getWorkflowHealth",
  "createCommand",
  "updateCommand",
  "deleteCommand",
  "listCommands",
  "listAvailableFunctions",
  "listGroups",
  "createGroup",
  "updateGroup",
  "deleteGroup",
  "listGroupMembers",
  "addUserToGroup",
  "removeUserFromGroup",
  "listGroupsForUser",
  "listPermissions",
  "requestUploadUrl",
  "completeUpload",
  "requestPosterUploadUrl",
  "getResourceUsage",
  "createFolder",
  "getResource",
  "listResources",
  "updateResource",
  "deleteResource",
  "requestProcessing",
  "setTwitchToken",
  "setRelayConfig",
  "deleteTwitchToken",
  "getTwitchLink",
  "startTwitchDeviceLogin",
  "getTwitchDeviceLogin",
  "cancelTwitchDeviceLogin",
  "lookupPairing",
  "decidePairing",
  "listPendingPairings",
  "twitchGetChannelInformation",
  "twitchGetGames",
  "twitchSearchCategories",
  "twitchModifyChannelInformation",
  "twitchCreateStreamMarker",
  "twitchGetAdSchedule",
  "twitchSnoozeNextAd",
  "twitchGetUsers",
  "twitchGetBlockedTerms",
  "twitchAddBlockedTerm",
  "twitchRemoveBlockedTerm",
  "twitchBanUser",
  "twitchUnbanUser",
  "twitchGetChatSettings",
  "twitchUpdateChatSettings",
  "twitchSendChatMessage",
  "twitchSendChatAnnouncement",
  "twitchSendShoutout",
  "twitchGetChatters",
  "twitchGetChatPins",
  "twitchPinChatMessage",
  "twitchUnpinChatMessage",
  "twitchCreateClip",
  "dispatchFieldOptionsRequest",
  "getScenes",
  "getScene",
  "getAvailableWidgets",
  "createScene",
  "updateScene",
  "deleteScene",
  "getSceneEditorSession",
  "repairScene",
  "listAlertCompositions",
  "getAlertComposition",
  "createAlertComposition",
  "updateAlertComposition",
  "deleteAlertComposition",
  "getCompositionPreviewUrl",
  "getStreamStatus",
  "listStreamSessions",
  "getStreamSession",
  "getStreamSessionTotals",
  "getViewerTotals",
  "getLeaderboard",
  "getStreamSessionGauges",
  "getStreamSessionEvents",
  "triggerEvent",
  "handleInboundWebhook",
  "triggerWorkflowByName",
  "runActions",
  "replayWorkflowRun",
  "getDashboardStats",
  "replayAlert",
  "skipCurrentAlert",
  "clearAlertQueue",
  "listAlerts",
  "getAlertOverview",
  "getAlertQueue",
  "getObsStatus",
  "listViewerFacts",
  "listUISettings",
  "getUISetting",
  "setUISetting",
  "deleteUISetting",
  "listUISettingChangesSince",
  "completeModuleOAuth",
  "mintOverlayToken",
  "revokeOverlayToken",
  "rotateOverlayToken",
  "listOverlayTokens",
  "executeCommand",
  "getAvailableCommands",
  "getDashboard",
  "getAvailableWorkflows",
  "getWorkflowStatus",
  "getWorkflowHistory",
  "cancelWorkflow",
  "subscribeTriggerChanges",
  "subscribeStreamEvents",
  "subscribeEngineEvents",
  "answerEngineRequest",
  "listEvents",
  "getEventLogSettings",
  "setEventLogSelection",
  "getUserProfile",
  "awardTreatsToUser",
  "simulateTwitchEvent",
  "exportConfig",
  "previewImport",
  "importConfig",
] as const;

/** True only when A and B are the same type, invariantly. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

// Diverge from `Woofx3EngineApi` and this stops compiling. The error names
// the offending key, so the fix is to declare it or drop it -- not to widen
// the list.
export type _SurfaceMatchesContract = Assert<Equals<(typeof RPC_METHODS)[number], keyof Woofx3EngineApi>>;

// Every delegated name must exist on Api, so a contract entry with no
// implementation is a compile error rather than a runtime "not a function".
export type _ContractIsImplemented = Assert<Equals<Exclude<keyof Woofx3EngineApi, keyof Api>, never>>;

// capnweb only exposes methods found on the prototype chain, so these are
// installed on the prototype rather than per instance. The hand-written
// methods above, which inject the session's clientId, are wrapped in place;
// the rest delegate to Api. Either way the lease is checked first, so no
// method can be added that skips it.
const prototype = ApiSession.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
for (const key of RPC_METHODS) {
  const handWritten = Object.hasOwn(prototype, key) ? prototype[key] : null;
  prototype[key] = async function (this: ApiSession, ...args: unknown[]) {
    ApiSession.assertLive(this);
    if (handWritten !== null) {
      return handWritten.apply(this, args);
    }
    // Reaching `api` past `private` deliberately: the delegation is
    // installed from outside the class body, and widening the field to
    // public would put the whole Api object on a session a client holds.
    const target = (this as unknown as { api: Record<string, (...a: unknown[]) => unknown> }).api;
    return target[key](...args);
  };
}
