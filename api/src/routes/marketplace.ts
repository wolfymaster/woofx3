import { randomUUID } from "node:crypto";
import type {
  MarketplaceBundleInstallResult,
  MarketplaceInstallRequest,
  MarketplaceInstallResult,
  MarketplaceListingInspection,
  MarketplaceModuleLicense,
  MarketplacePurchaseIntent,
} from "@woofx3/api";
import { manifestLocalEndpoints, manifestPermissions } from "@woofx3/api/module-manifest";
import type { DbClient } from "../db-client";
import type { EngineInstallId } from "../install-id";
import {
  type MarketplaceClient,
  type MarketplaceDownload,
  MarketplaceError,
  type MarketplaceListing,
} from "../marketplace-client";
import { approvalShortfall, type ModuleArchiveContents, readModuleArchive } from "../module-archive";
import {
  handArchiveToBarkloader,
  type InstallEventOrigin,
  sendAlreadyInstalled,
  sendInstallFailed,
  stringList,
} from "../module-install";
import { compositionsRoutes } from "./compositions";
import { routeModule } from "./context";
import { withMarketplaceErrors } from "./marketplace-catalog";
import { scenesRoutes } from "./scenes";

/**
 * Installing from the marketplace by listing id.
 *
 * The engine does every step itself -- reading the listing, claiming it for
 * the buyer, downloading and verifying the archive, checking consent -- so
 * what it installs is exactly what the marketplace recorded, whoever asked.
 * A caller acting for a buyer passes that buyer's marketplace token; the
 * engine forwards it and keeps nothing.
 *
 * A module downloads with its license key and the engine's install id. The
 * caller may pass the key; otherwise the engine claims the listing and takes
 * the key from the claim. The key is a credential: it is never logged.
 */

/**
 * The key a marketplace module is installed under. The dashboard stores it
 * and correlates install webhooks by it, so its format is a contract: the
 * module id (the manifest id every edition shares, which is the catalog's
 * `moduleKey`, not the listing id), the listing's version, and the first 7
 * hex characters of the archive's SHA-256. Barkloader computes the same key
 * from the archive and refuses an install whose expected key differs.
 *
 * Keying by module id is what makes a later edition, which is a separate
 * listing, replace the installed module in place. Which listing and edition
 * is installed is recorded as the module's marketplace provenance instead.
 */
export function marketplaceModuleKey(moduleId: string, version: string, sha256: string): string {
  return `${moduleId}:${version}:${sha256.slice(0, 7)}`;
}

/**
 * Refuses an archive whose manifest id is not the module id the catalog
 * names. Barkloader would refuse it too, but only after the upload, as a
 * key mismatch that names neither the listing nor the cause.
 */
function requireManifestMatchesListing(listing: MarketplaceListing, manifest: Record<string, unknown>): void {
  const manifestId = manifest.id;
  if (manifestId !== listing.moduleId) {
    throw new Error(
      `Marketplace listing ${listing.id} is module ${JSON.stringify(listing.moduleId)}, but its archive's manifest id is ${JSON.stringify(manifestId ?? null)}`
    );
  }
}

const MARKETPLACE_EVENT_ORIGIN: InstallEventOrigin = { source: "marketplace" };

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

function optionalLicenseKey(caller: string, value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${caller}: licenseKey must be a string`);
  }
  return value;
}

/**
 * What an install downloads with once it may go ahead: the license key, or
 * null to download without one, which the marketplace allows for a free
 * listing and for a listing the buyer token's buyer holds.
 */
type InstallLicense =
  | { status: "licensed"; key: string | null }
  | { status: "payment_required"; intent: MarketplacePurchaseIntent | null };

/**
 * Claims the listing for the install and takes the key the claim answers
 * with: for the token's buyer, or anonymously without a token, naming the
 * engine's install id so the marketplace keys the claim on it. A marketplace
 * that issues no keys answers a claim without one, and one that predates
 * anonymous claims refuses an anonymous claim with 401 `unauthorized` (not
 * `account_required`, which is a paid listing). Either way the install
 * downloads without a key, exactly as it did against such a marketplace.
 */
async function claimLicense(
  marketplace: MarketplaceClient,
  listingId: string,
  buyerToken: string | undefined,
  installId: Pick<EngineInstallId, "get">
): Promise<InstallLicense> {
  try {
    const anonymousInstallId = buyerToken === undefined ? await installId.get() : undefined;
    const acquired = await marketplace.acquire(listingId, buyerToken, anonymousInstallId);
    if (acquired.status === "payment_required") {
      return acquired;
    }
    return { status: "licensed", key: acquired.license?.key ?? null };
  } catch (err) {
    const refusesAnonymousClaims =
      buyerToken === undefined && err instanceof MarketplaceError && err.status === 401 && err.code === "unauthorized";
    if (refusesAnonymousClaims) {
      return { status: "licensed", key: null };
    }
    throw err;
  }
}

/** The key an installed module of this listing holds, or null. */
async function heldLicenseKey(
  db: Pick<DbClient, "findModuleByModuleId">,
  moduleId: string,
  listingId: string
): Promise<string | null> {
  const installed = await db.findModuleByModuleId(moduleId);
  return installed?.marketplaceListingId === listingId ? (installed.marketplaceLicenseKey ?? null) : null;
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
    const licenseKey = optionalLicenseKey(caller, request.licenseKey);
    const marketplace = requireMarketplace(this.marketplace);

    const listing = await marketplace.getListing(listingId);
    requireModuleListing(listing);
    const { name, version } = listing;
    this.logger.info("Installing marketplace listing", {
      clientId,
      listingId,
      version,
      buyer: Boolean(buyerToken),
      hasLicense: licenseKey !== undefined,
    });

    // A reinstall reuses the key this engine already holds for the listing:
    // a marketplace from before install-id-keyed claims mints a new
    // entitlement for every anonymous claim.
    const heldKey =
      licenseKey === undefined && buyerToken === undefined
        ? await heldLicenseKey(this.db, listing.moduleId, listingId)
        : null;
    const license: InstallLicense =
      licenseKey !== undefined || heldKey !== null
        ? { status: "licensed", key: licenseKey ?? heldKey }
        : await withMarketplaceErrors(() => claimLicense(marketplace, listingId, buyerToken, this.installId));
    if (license.status === "payment_required") {
      return license.intent === null
        ? { status: "payment_required", name, version }
        : { status: "payment_required", name, version, intent: license.intent };
    }
    const download = await withMarketplaceErrors(async () =>
      marketplace.getModuleDownload(listingId, {
        buyerToken,
        license: license.key === null ? undefined : { key: license.key, installId: await this.installId.get() },
      })
    );
    const moduleKey = marketplaceModuleKey(listing.moduleId, version, download.sha256);
    const { archive, contents } = await fetchVerifiedArchive(marketplace, download, async (message) => {
      this.logger.error("Marketplace archive refused", { clientId, listingId, moduleKey, message });
      await sendInstallFailed(
        this.webhookClient,
        { moduleKey, name, version, error: `Failed to fetch marketplace archive: ${message}` },
        clientId,
        MARKETPLACE_EVENT_ORIGIN
      );
    });
    try {
      requireManifestMatchesListing(listing, contents.manifest);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Marketplace archive refused", { clientId, listingId, moduleKey, message });
      await sendInstallFailed(
        this.webhookClient,
        { moduleKey, name, version, error: message },
        clientId,
        MARKETPLACE_EVENT_ORIGIN
      );
      throw err;
    }

    const shortfall = approvalShortfall(contents.manifest, { approvedPermissions, approvedLocalEndpoints });
    if (shortfall !== null) {
      this.logger.info("Marketplace listing needs approval", { listingId, ...shortfall });
      return { status: "needs_approval", name, version, ...shortfall };
    }

    const existing = await this.db.getModuleByModuleKey(moduleKey);
    if (existing) {
      this.logger.info("Module already installed, skipping upload", { clientId, moduleKey });
      await sendAlreadyInstalled(this.webhookClient, existing, moduleKey, clientId, MARKETPLACE_EVENT_ORIGIN);
      return { status: "installed", moduleKey, alreadyInstalled: true };
    }

    await handArchiveToBarkloader((path, init) => this.barkloaderRequest(path, init), this.logger, {
      bytes: archive,
      fileName: `${name}-${version}.zip`,
      clientId,
      moduleKey,
      origin: { kind: "marketplace", listingId, edition: listing.edition, licenseKey: license.key },
    });
    return { status: "installed", moduleKey };
  },

  async inspectMarketplaceListing(listingId: string, buyerToken?: string): Promise<MarketplaceListingInspection> {
    requireListingId("inspectMarketplaceListing", listingId);
    const marketplace = requireMarketplace(this.marketplace);
    const listing = await marketplace.getListing(listingId);
    requireModuleListing(listing);
    // Without a license key: the review comes before consent, so nothing is
    // claimed for it. The marketplace serves a currently free listing
    // without a key, and any listing to a buyer token whose buyer holds it.
    const download = await marketplace.getModuleDownload(listingId, { buyerToken: buyerToken || undefined });
    const { archive, contents } = await fetchVerifiedArchive(marketplace, download, async () => {});
    const { manifest } = contents;
    requireManifestMatchesListing(listing, manifest);
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    return {
      listingId,
      moduleId: listing.moduleId,
      edition: listing.edition,
      type: listing.type,
      name: listing.name,
      version: listing.version,
      moduleKey: marketplaceModuleKey(listing.moduleId, listing.version, download.sha256),
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

  async getInstalledModuleLicense(moduleId: string): Promise<MarketplaceModuleLicense | null> {
    if (typeof moduleId !== "string" || moduleId === "") {
      throw new Error("getInstalledModuleLicense: moduleId is required");
    }
    const installed = await this.db.findModuleByModuleId(moduleId);
    if (!installed) {
      throw new Error(`getInstalledModuleLicense: module ${moduleId} is not installed`);
    }
    if (!installed.marketplaceListingId || !installed.marketplaceLicenseKey) {
      return null;
    }
    return { listingId: installed.marketplaceListingId, key: installed.marketplaceLicenseKey };
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
