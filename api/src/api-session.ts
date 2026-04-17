import { RpcTarget } from "capnweb";
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

  async uninstallModule(id: string, context?: { moduleKey?: string }) {
    return this.api.uninstallModule(id, {
      clientId: this.clientId,
      moduleKey: context?.moduleKey,
    });
  }

  async uninstallEngineModule(name: string, context?: { moduleKey?: string }) {
    return this.api.uninstallEngineModule(name, {
      clientId: this.clientId,
      moduleKey: context?.moduleKey,
    });
  }
}

// Delegate all Api prototype methods onto ApiSession prototype so capnweb
// can discover them as class methods (not instance properties).
for (const key of Object.getOwnPropertyNames(Api.prototype)) {
  if (
    key === "constructor" ||
    typeof (Api.prototype as any)[key] !== "function" ||
    key in ApiSession.prototype
  ) {
    continue;
  }
  (ApiSession.prototype as any)[key] = function (this: ApiSession, ...args: any[]) {
    return ((this as any).api as any)[key](...args);
  };
}
