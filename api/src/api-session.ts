import { RpcTarget } from "capnweb";
import type { Woofx3EngineApi } from "@woofx3/api";
import { Api } from "./api";

/**
 * Per-connection session wrapper around the shared Api instance.
 * Carries the authenticated clientId so individual RPC methods
 * can identify the caller without requiring it as a parameter.
 *
 * Methods that need the clientId (e.g. installModuleZip) are overridden
 * to inject it automatically. All other method calls are forwarded to
 * the underlying Api instance via prototype delegation.
 */
export class ApiSession extends RpcTarget {
  readonly clientId: string;
  private api: Api;

  constructor(api: Api, clientId: string) {
    super();
    this.api = api;
    this.clientId = clientId;
  }

  async installModuleZip(
    fileName: string,
    zipBase64: string,
    context?: { moduleKey?: string },
  ) {
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
    },
  ) {
    return this.api.installModuleFromUrl(downloadUrl, moduleKey, {
      clientId: this.clientId,
      moduleKey,
      ...ctx,
    });
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

  async createResourceInstance(moduleName: string, kind: string, instanceId: string, displayName: string) {
    return this.api.createResourceInstance(moduleName, kind, instanceId, displayName, {
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
 * published whatever happened to be there: 88 methods against a 72-method
 * contract, including `setApplicationId` (rewrites the process-wide
 * application id), `initSubscriptions` (re-subscribes NATS subjects, and
 * duplicates them on a second call) and `handleProcessingCallback` (which
 * `http.ts` deliberately keeps off the capnweb surface). Nothing declared the
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
  "setOverlayPublicUrl",
  "getStorageConfig",
  "setStorageConfig",
  "deleteClient",
  "getModules",
  "getModule",
  "installModuleZip",
  "installModuleFromUrl",
  "listEngineModules",
  "uninstallModule",
  "uninstallEngineModule",
  "checkModuleResourceUsage",
  "getModuleSettings",
  "updateModuleSetting",
  "getModuleManifest",
  "createResourceInstance",
  "deleteResourceInstance",
  "listAllResourceInstances",
  "listResourceInstancesForModule",
  "getTriggers",
  "getActions",
  "getWorkflows",
  "getWorkflow",
  "createWorkflow",
  "updateWorkflow",
  "deleteWorkflow",
  "setWorkflowEnabled",
  "getWorkflowRuns",
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
  "createFolder",
  "getResource",
  "listResources",
  "updateResource",
  "deleteResource",
  "requestProcessing",
  "setTwitchToken",
  "deleteTwitchToken",
  "dispatchFieldOptionsRequest",
  "getScenes",
  "getScene",
  "getAvailableWidgets",
  "createScene",
  "updateScene",
  "deleteScene",
  "getStreamStatus",
  "triggerEvent",
  "triggerWorkflowByName",
  "getDashboardStats",
  "replayAlert",
  "skipCurrentAlert",
  "clearAlertQueue",
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
  "getUserProfile",
  "awardTreatsToUser",
  "simulateTwitchEvent",
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
// installed on the prototype rather than per instance.
for (const key of RPC_METHODS) {
  if (key in ApiSession.prototype) {
    // Hand-written above to inject the session's clientId.
    continue;
  }
  (ApiSession.prototype as unknown as Record<string, unknown>)[key] = function (this: ApiSession, ...args: unknown[]) {
    // Reaching `api` past `private` deliberately: the delegation is
    // installed from outside the class body, and widening the field to
    // public would put the whole Api object on a session a client holds.
    const target = (this as unknown as { api: Record<string, (...a: unknown[]) => unknown> }).api;
    return target[key](...args);
  };
}
