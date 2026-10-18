import type { SharedLogger } from "@woofx3/common/logging";
import type { WebhookClient } from "./webhook-client";

/**
 * The steps every server-side module install shares, whichever way the
 * archive reached the engine: fetching it with a deadline and a size cap,
 * answering for a module that is already installed, reporting a failure, and
 * handing the bytes to barkloader. `installModuleFromUrl` and
 * `installMarketplaceListing` both install through these, so the webhooks a
 * dashboard sees do not depend on which one it called.
 */

/** How long fetching a module archive may take. */
export const MODULE_ARCHIVE_FETCH_TIMEOUT_MS = 30_000;

/**
 * The largest module archive the engine fetches. Archives carry code, a
 * manifest and a few assets; the cap keeps a malformed or hostile source from
 * making the engine buffer an unbounded download.
 */
export const MODULE_ARCHIVE_MAX_BYTES = 50 * 1024 * 1024;

/** Where an install came from, echoed on the install webhooks the engine sends itself. */
export type ModuleInstallSource = "marketplace";

export interface ArchiveFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /**
   * `"error"` refuses a redirect instead of following it. A caller that
   * checked the URL's host must refuse one, or a redirect would take the
   * fetch to a host nobody checked.
   */
  redirect?: RequestRedirect;
}

/**
 * The archive at `url`, read in full. Throws when the answer is not a 2xx,
 * when it takes longer than `timeoutMs`, or when it is larger than
 * `maxBytes`, by its declared length or by what actually arrives.
 */
export async function fetchModuleArchive(url: string, options: ArchiveFetchOptions = {}): Promise<Uint8Array> {
  const timeoutMs = options.timeoutMs ?? MODULE_ARCHIVE_FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MODULE_ARCHIVE_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: options.redirect ?? "follow" });
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`Marketplace fetch failed: ${res.status} ${res.statusText}`);
    }
    const contentLength = Number(res.headers.get("content-length") ?? "0");
    if (contentLength > maxBytes) {
      await res.body?.cancel();
      throw new Error(`Marketplace archive exceeds size cap (${contentLength} > ${maxBytes})`);
    }
    const bytes = new Uint8Array((await res.arrayBuffer()) as ArrayBuffer);
    if (bytes.byteLength > maxBytes) {
      throw new Error(`Marketplace archive exceeds size cap (${bytes.byteLength} > ${maxBytes})`);
    }
    return bytes;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Marketplace fetch timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
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
  source?: ModuleInstallSource
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
      ...(source ? { source } : {}),
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
  source?: ModuleInstallSource
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
      ...(source ? { source } : {}),
    },
    clientId || undefined
  );
}

/** The marketplace listing an archive came from, recorded on the module row. */
export interface MarketplaceOrigin {
  listingId: string;
  edition: number;
}

/**
 * Gives barkloader an archive to install under `moduleKey`. Barkloader
 * installs it asynchronously and reports the outcome as `module.installed` or
 * `module.install_failed`; the message returned here only says it accepted
 * the upload.
 *
 * `marketplace` travels with the archive because barkloader writes the module
 * row only once the asynchronous install gets that far, so nothing here could
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
    marketplace?: MarketplaceOrigin;
  }
): Promise<string> {
  const formData = new FormData();
  formData.append(
    "file",
    new File([archive.bytes as Uint8Array<ArrayBuffer>], archive.fileName, { type: "application/zip" })
  );
  formData.append("client_id", archive.clientId);
  formData.append("module_key", archive.moduleKey);
  if (archive.marketplace) {
    formData.append("marketplace_listing_id", archive.marketplace.listingId);
    formData.append("marketplace_edition", String(archive.marketplace.edition));
  }

  const response = await barkloaderRequest("/functions", { method: "POST", body: formData });
  const json = (await response.json()) as { message?: string };
  logger.info("Module archive handed to barkloader", {
    clientId: archive.clientId,
    moduleKey: archive.moduleKey,
    fileName: archive.fileName,
    marketplace: archive.marketplace,
    message: json.message,
  });
  return json.message ?? "Module uploaded";
}
