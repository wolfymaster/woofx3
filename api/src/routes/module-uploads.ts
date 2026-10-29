import { createHash } from "node:crypto";
import { readModuleArchive, approvalShortfall } from "../module-archive";
import {
  handArchiveToBarkloader,
  type InstallEventOrigin,
  sendAlreadyInstalled,
  sendInstallFailed,
  stringList,
} from "../module-install";
import { routeModule } from "./context";
import { marketplaceModuleKey } from "./marketplace";
import { RESOURCE_KIND_CUSTOM_MODULE } from "./resources";

/**
 * Installing a module from a custom module archive the user uploaded as an
 * engine resource. The engine reads the archive from its own storage, so
 * what is approved and installed is exactly what was stored.
 */

/**
 * The key barkloader computes for an archive: the manifest's id and version
 * and the first 7 hex characters of the archive's SHA-256. Barkloader refuses
 * an install whose expected key differs, and the dashboard correlates install
 * webhooks by it.
 */
export function uploadedModuleKey(manifest: Record<string, unknown>, archive: Uint8Array): string {
  const { id, version } = manifest;
  if (typeof id !== "string" || id === "") {
    throw new Error("The module archive's manifest has no id");
  }
  if (typeof version !== "string" || version === "") {
    throw new Error("The module archive's manifest has no version");
  }
  const sha256 = createHash("sha256").update(archive).digest("hex");
  return marketplaceModuleKey(id, version, sha256);
}

export const moduleUploadsRoutes = routeModule({
  /**
   * Install the module in a completed custom module resource, once its
   * manifest's permissions and local endpoints are all approved. Resolves
   * with the module key as soon as barkloader has the archive; the outcome
   * arrives as `module.installed` or `module.install_failed` keyed by it.
   */
  async installModuleFromResource(
    resourceId: string,
    request: { approvedPermissions: string[]; approvedLocalEndpoints: string[] },
    context: { clientId: string }
  ): Promise<{ moduleKey: string }> {
    const caller = "installModuleFromResource";
    if (typeof resourceId !== "string" || resourceId === "") {
      throw new Error(`${caller}: resourceId is required`);
    }
    const clientId = context?.clientId;
    if (!clientId) {
      throw new Error("clientId is required to install a module");
    }
    const approvedPermissions = stringList(caller, "approvedPermissions", request?.approvedPermissions);
    const approvedLocalEndpoints = stringList(caller, "approvedLocalEndpoints", request?.approvedLocalEndpoints);

    const row = await this.db.getResource({ id: resourceId });
    if (row.kind !== RESOURCE_KIND_CUSTOM_MODULE) {
      throw new Error(`${row.name} is not a custom module archive, so it cannot be installed`);
    }
    if (row.status !== "ready") {
      throw new Error(`${row.name} has not finished uploading (status ${row.status}), so it cannot be installed yet`);
    }
    const repositoryKey = row.repositoryKey ?? "";
    if (repositoryKey.length === 0) {
      throw new Error(`${row.name} has no stored archive`);
    }

    const response = await this.barkloaderRequest(
      `/assets/custom-module?${new URLSearchParams({ repositoryKey }).toString()}`,
      { method: "GET" }
    );
    const archive = new Uint8Array(await response.arrayBuffer());
    const { manifest } = readModuleArchive(archive);
    const moduleKey = uploadedModuleKey(manifest, archive);

    const shortfall = approvalShortfall(manifest, { approvedPermissions, approvedLocalEndpoints });
    if (shortfall !== null) {
      const declared = [...shortfall.unapproved, ...shortfall.unapprovedLocalEndpoints.map((id) => `local:${id}`)];
      this.logger.info("Custom module install needs approval", { resourceId, moduleKey, ...shortfall });
      throw new Error(`${row.name} declares what was not approved: ${declared.join(", ")}`);
    }

    const origin: InstallEventOrigin = { source: "upload", uploadResourceId: resourceId };
    const name = typeof manifest.name === "string" && manifest.name !== "" ? manifest.name : row.name;
    const version = String(manifest.version);
    const existing = await this.db.getModuleByModuleKey(moduleKey);
    if (existing) {
      this.logger.info("Module already installed, skipping upload", { clientId, moduleKey, resourceId });
      await sendAlreadyInstalled(this.webhookClient, existing, moduleKey, clientId, origin);
      return { moduleKey };
    }

    this.logger.info("Installing custom module", { clientId, resourceId, moduleKey });
    try {
      await handArchiveToBarkloader((path, init) => this.barkloaderRequest(path, init), this.logger, {
        bytes: archive,
        fileName: row.name,
        clientId,
        moduleKey,
        origin: { kind: "upload", resourceId },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await sendInstallFailed(this.webhookClient, { moduleKey, name, version, error: message }, clientId, origin);
      throw err;
    }
    return { moduleKey };
  },
});
