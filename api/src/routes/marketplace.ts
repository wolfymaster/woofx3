import { randomUUID } from "node:crypto";
import type {
  MarketplaceBundleInstallResult,
  MarketplaceInstallRequest,
  MarketplaceInstallResult,
  MarketplaceListingInspection,
} from "@woofx3/api";
import type { MarketplaceClient, MarketplaceDownload, MarketplaceListing } from "../marketplace-client";
import {
  type ModuleArchiveContents,
  manifestLocalEndpoints,
  manifestPermissions,
  readModuleArchive,
  unapprovedIds,
} from "../module-archive";
import { handArchiveToBarkloader, sendAlreadyInstalled, sendInstallFailed } from "../module-install";
import { compositionsRoutes } from "./compositions";
import { routeModule } from "./context";
import { scenesRoutes } from "./scenes";

/**
 * Installing from the marketplace by listing id.
 *
 * The engine does every step itself -- reading the listing, claiming it for
 * the buyer, downloading and verifying the archive, checking consent -- so
 * what it installs is exactly what the marketplace recorded, whoever asked.
 * A caller acting for a buyer passes that buyer's marketplace token; the
 * engine forwards it and keeps nothing.
 */

/**
 * The key a marketplace module is installed under. The dashboard stores it
 * and correlates install webhooks by it, so its format is a contract: the
 * listing id, the listing's version, and the first 7 hex characters of the
 * archive's SHA-256.
 */
export function marketplaceModuleKey(listingId: string, version: string, sha256: string): string {
  return `${listingId}:${version}:${sha256.slice(0, 7)}`;
}

function requireMarketplace(marketplace: MarketplaceClient | null): MarketplaceClient {
  if (!marketplace) {
    throw new Error("Marketplace installs are turned off on this engine (marketplaceUrl is blank)");
  }
  return marketplace;
}

function requireListingId(caller: string, listingId: string): void {
  if (typeof listingId !== "string" || listingId === "") {
    throw new Error(`${caller}: listingId is required`);
  }
}

function requireModuleListing(listing: MarketplaceListing): asserts listing is MarketplaceListing & {
  type: "module" | "theme";
} {
  if (listing.type !== "module" && listing.type !== "theme") {
    throw new Error(`${listing.name} is a ${listing.type} listing and does not install as a module`);
  }
}

function stringList(caller: string, field: string, value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`${caller}: ${field} must be an array of strings`);
  }
  return value;
}

/**
 * The listing's archive, verified. `onFailure` runs before the error is
 * rethrown, so an install can report a download that never arrived.
 */
async function fetchVerifiedArchive(
  marketplace: MarketplaceClient,
  download: MarketplaceDownload,
  onFailure: (message: string) => Promise<void>
): Promise<{ archive: Uint8Array; contents: ModuleArchiveContents }> {
  try {
    const archive = await marketplace.fetchArchive(download);
    return { archive, contents: readModuleArchive(archive) };
  } catch (err) {
    await onFailure(err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export const marketplaceRoutes = routeModule({
  async installMarketplaceListing(
    listingId: string,
    request: MarketplaceInstallRequest,
    context: { clientId: string }
  ): Promise<MarketplaceInstallResult> {
    const caller = "installMarketplaceListing";
    requireListingId(caller, listingId);
    const clientId = context?.clientId;
    if (!clientId) {
      throw new Error("clientId is required to install a module");
    }
    const approvedPermissions = stringList(caller, "approvedPermissions", request?.approvedPermissions);
    const approvedLocalEndpoints = stringList(caller, "approvedLocalEndpoints", request?.approvedLocalEndpoints);
    const buyerToken = request.buyerToken || undefined;
    const marketplace = requireMarketplace(this.marketplace);

    const listing = await marketplace.getListing(listingId);
    requireModuleListing(listing);
    const { name, version } = listing;
    this.logger.info("Installing marketplace listing", { clientId, listingId, version, buyer: Boolean(buyerToken) });

    if (buyerToken) {
      const acquired = await marketplace.acquire(listingId, buyerToken);
      if (acquired.status === "payment_required") {
        return { status: "payment_required", name, version };
      }
    }

    const download = await marketplace.getModuleDownload(listingId, buyerToken);
    const moduleKey = marketplaceModuleKey(listingId, version, download.sha256);
    const { archive, contents } = await fetchVerifiedArchive(marketplace, download, async (message) => {
      this.logger.error("Marketplace archive refused", { clientId, listingId, moduleKey, message });
      await sendInstallFailed(
        this.webhookClient,
        { moduleKey, name, version, error: `Failed to fetch marketplace archive: ${message}` },
        clientId,
        "marketplace"
      );
    });

    const unapproved = unapprovedIds(manifestPermissions(contents.manifest), approvedPermissions);
    const unapprovedLocalEndpoints = unapprovedIds(
      manifestLocalEndpoints(contents.manifest).map((endpoint) => endpoint.id),
      approvedLocalEndpoints
    );
    if (unapproved.length > 0 || unapprovedLocalEndpoints.length > 0) {
      this.logger.info("Marketplace listing needs approval", { listingId, unapproved, unapprovedLocalEndpoints });
      return { status: "needs_approval", name, version, unapproved, unapprovedLocalEndpoints };
    }

    const existing = await this.db.getModuleByModuleKey(moduleKey);
    if (existing) {
      this.logger.info("Module already installed, skipping upload", { clientId, moduleKey });
      await sendAlreadyInstalled(this.webhookClient, existing, moduleKey, clientId, "marketplace");
      return { status: "installed", moduleKey, alreadyInstalled: true };
    }

    await handArchiveToBarkloader((path, init) => this.barkloaderRequest(path, init), this.logger, {
      bytes: archive,
      fileName: `${name}-${version}.zip`,
      clientId,
      moduleKey,
      marketplace: { listingId, edition: listing.edition },
    });
    return { status: "installed", moduleKey };
  },

  async inspectMarketplaceListing(listingId: string, buyerToken?: string): Promise<MarketplaceListingInspection> {
    requireListingId("inspectMarketplaceListing", listingId);
    const marketplace = requireMarketplace(this.marketplace);
    const listing = await marketplace.getListing(listingId);
    requireModuleListing(listing);
    const download = await marketplace.getModuleDownload(listingId, buyerToken || undefined);
    const { archive, contents } = await fetchVerifiedArchive(marketplace, download, async () => {});
    const { manifest } = contents;
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    return {
      listingId,
      type: listing.type,
      name: listing.name,
      version: listing.version,
      moduleKey: marketplaceModuleKey(listingId, listing.version, download.sha256),
      sha256: download.sha256,
      sizeBytes: archive.byteLength,
      manifest: {
        id: text(manifest.id),
        name: text(manifest.name),
        version: text(manifest.version),
        description: text(manifest.description),
      },
      permissions: manifestPermissions(manifest),
      localEndpoints: manifestLocalEndpoints(manifest),
      files: contents.files,
    };
  },

  async installMarketplaceBundle(listingId: string, buyerToken?: string): Promise<MarketplaceBundleInstallResult> {
    requireListingId("installMarketplaceBundle", listingId);
    const marketplace = requireMarketplace(this.marketplace);
    const token = buyerToken || undefined;
    const listing = await marketplace.getListing(listingId);
    if (listing.type !== "overlay" && listing.type !== "alert") {
      throw new Error(`${listing.name} is a ${listing.type} listing and does not install as a bundle`);
    }
    if (token) {
      const acquired = await marketplace.acquire(listingId, token);
      if (acquired.status === "payment_required") {
        return { status: "payment_required", name: listing.name, version: listing.version };
      }
    }

    const bundle = await marketplace.getBundle(listingId, token);
    const layoutJson = JSON.stringify(bundle.layout ?? {});
    const widgetsJson = JSON.stringify(bundle.widgets ?? []);
    this.logger.info("Installing marketplace bundle", { listingId, type: listing.type });

    // The same writes the scene editor and the alert library use, so an
    // installed bundle is indistinguishable from one made by hand.
    if (listing.type === "overlay") {
      const created = await scenesRoutes.createScene.call(this, {
        name: listing.name,
        description: listing.description,
        layoutJson,
        widgetsJson,
        correlationKey: randomUUID(),
      });
      return { status: "installed", listingId, engineId: created.id, kind: "scene" };
    }
    const created = await compositionsRoutes.createAlertComposition.call(this, {
      name: listing.name,
      description: listing.description,
      layoutJson,
      widgetsJson,
      behaviorsJson: JSON.stringify(bundle.behaviors ?? {}),
      inputsJson: JSON.stringify(bundle.inputs ?? []),
      correlationKey: randomUUID(),
    });
    return { status: "installed", listingId, engineId: created.id, kind: "alert" };
  },
});
