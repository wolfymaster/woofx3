import type { ModuleInstallSource } from "@woofx3/api";
import type { SharedLogger } from "@woofx3/common/logging";
import type { WebhookClient } from "./webhook-client";

/**
 * The steps every server-side module install shares, whichever way the
 * archive reached the engine: answering for a module that is already
 * installed, reporting a failure, and handing the bytes to barkloader. Both
 * install paths fetch their archive through `MarketplaceClient.fetchArchive`
 * and install through these, so the checks a download passes and the
 * webhooks a dashboard sees do not depend on which one it called.
 */

/**
 * Where an install came from, as the install webhooks the engine sends itself
 * name it. An upload also names the custom module resource it read.
 */
export type InstallEventOrigin =
  | { source: Extract<ModuleInstallSource, "marketplace"> }
  | { source: Extract<ModuleInstallSource, "upload">; uploadResourceId: string };

/** An RPC argument that must be an array of strings, such as an approval list. */
export function stringList(caller: string, field: string, value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`${caller}: ${field} must be an array of strings`);
  }
  return value;
}

/** An installed module, as `getModuleByModuleKey` returns it. */
export interface InstalledModuleRef {
  moduleId: string;
  name: string;
  version: string;
}

/**
 * Answers an install of a module key that is already installed: the
 * dashboard waiting on that key gets `module.installed` with
 * `alreadyInstalled`, exactly as if the install had just finished.
 */
export async function sendAlreadyInstalled(
  webhookClient: WebhookClient | null,
  existing: InstalledModuleRef,
  moduleKey: string,
  clientId: string,
  origin?: InstallEventOrigin
): Promise<void> {
  if (!webhookClient) {
    return;
  }
  await webhookClient.send(
    {
      type: "module.installed",
      modulePrefix: existing.moduleId,
      moduleName: existing.name,
      version: existing.version,
      moduleKey,
      alreadyInstalled: true,
      ...origin,
    },
    clientId || undefined
  );
}

/**
 * Reports an install that failed before barkloader was given the archive.
 * Failures after the handoff are barkloader's to report.
 */
export async function sendInstallFailed(
  webhookClient: WebhookClient | null,
  install: { moduleKey: string; name: string; version: string; error: string },
  clientId: string,
  origin?: InstallEventOrigin
): Promise<void> {
  if (!webhookClient) {
    return;
  }
  await webhookClient.send(
    {
      type: "module.install_failed",
      modulePrefix: install.moduleKey.split(":")[0] ?? "",
      moduleName: install.name,
      version: install.version,
      moduleKey: install.moduleKey,
      error: install.error,
      ...origin,
    },
    clientId || undefined
  );
}

/**
 * Where an archive came from, recorded on the module row: a marketplace
 * listing and its edition, or the custom module resource it was read from.
 */
export type ArchiveOrigin =
  | { kind: "marketplace"; listingId: string; edition: number }
  | { kind: "upload"; resourceId: string };

/**
 * Gives barkloader an archive to install under `moduleKey`. Barkloader
 * installs it asynchronously and reports the outcome as `module.installed` or
 * `module.install_failed`; the message returned here only says it accepted
 * the upload.
 *
 * `origin` travels with the archive because barkloader writes the module row
 * only once the asynchronous install gets that far, so nothing here could
 * update the row afterwards without racing the install.
 */
export async function handArchiveToBarkloader(
  barkloaderRequest: (path: string, init?: RequestInit) => Promise<Response>,
  logger: SharedLogger,
  archive: {
    bytes: Uint8Array;
    fileName: string;
    clientId: string;
    moduleKey: string;
    origin?: ArchiveOrigin;
  }
): Promise<string> {
  const formData = new FormData();
  formData.append(
    "file",
    new File([archive.bytes as Uint8Array<ArrayBuffer>], archive.fileName, { type: "application/zip" })
  );
  formData.append("client_id", archive.clientId);
  formData.append("module_key", archive.moduleKey);
  if (archive.origin?.kind === "marketplace") {
    formData.append("marketplace_listing_id", archive.origin.listingId);
    formData.append("marketplace_edition", String(archive.origin.edition));
  }
  if (archive.origin?.kind === "upload") {
    formData.append("upload_resource_id", archive.origin.resourceId);
  }

  const response = await barkloaderRequest("/functions", { method: "POST", body: formData });
  const json = (await response.json()) as { message?: string };
  logger.info("Module archive handed to barkloader", {
    clientId: archive.clientId,
    moduleKey: archive.moduleKey,
    fileName: archive.fileName,
    origin: archive.origin,
    message: json.message,
  });
  return json.message ?? "Module uploaded";
}
