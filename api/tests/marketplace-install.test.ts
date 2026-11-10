import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  type MarketplaceBundleInstallResult,
  type MarketplaceInstallRequest,
  type MarketplaceInstallResult,
  type MarketplaceListingInspection,
  type MarketplacePurchaseIntent,
  parseMarketplaceCatalogError,
} from "@woofx3/api";
import { strToU8, zipSync } from "fflate";
import { resolveMarketplaceConfig } from "../src/config";
import {
  DEFAULT_MARKETPLACE_DOWNLOAD_HOSTS,
  DEFAULT_MARKETPLACE_URL,
  MarketplaceClient,
  MarketplaceError,
} from "../src/marketplace-client";
import { marketplaceModuleKey, marketplaceRoutes } from "../src/routes/marketplace";

// ---------- a fake marketplace ----------

interface FakeListing {
  listing: Record<string, unknown>;
  /** Answer to POST /catalog/{id}/acquire. */
  acquireStatus?: number;
  /** Replaces the acquire answer built from `acquireStatus`. */
  acquireAnswer?: () => Response;
  /** Refuses GET /modules/{id}/download with this answer instead of serving it. */
  downloadRefusal?: () => Response;
  /** Answer to GET /modules/{id}/download; built from `archive` when absent. */
  download?: (base: string) => Record<string, unknown>;
  archive?: Uint8Array;
  bundle?: Record<string, unknown>;
}

interface Seen {
  method: string;
  path: string;
  authorization: string | null;
  licenseKey: string | null;
  installId: string | null;
}

const listings = new Map<string, FakeListing>();
const archives = new Map<string, Uint8Array>();
const seen: Seen[] = [];

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function errorEnvelope(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

/** The key the fake marketplace issues for a listing. */
function licenseKeyFor(listingId: string): string {
  return `W3X-KEY-${listingId}`;
}

const PAID_INTENT: MarketplacePurchaseIntent = {
  id: "intent-1",
  kind: "full",
  amountCents: 500,
  currency: "usd",
  expiresAt: "2030-01-01T00:00:00Z",
};

const INSTALL_ID = "8d0f3c1e-2b4a-4c55-9e1d-0a7b6c5d4e3f";

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req): Promise<Response> {
    const url = new URL(req.url);
    seen.push({
      method: req.method,
      path: url.pathname,
      authorization: req.headers.get("authorization"),
      licenseKey: req.headers.get("x-license-key"),
      installId: req.headers.get("x-install-id"),
    });
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

    if (parts[0] === "files" && parts.length === 2) {
      const bytes = archives.get(parts[1]);
      return bytes ? new Response(bytes as Uint8Array<ArrayBuffer>) : new Response("missing", { status: 404 });
    }
    if (parts[0] === "redirect") {
      return Response.redirect(`http://localhost:${server.port}/files/${parts[1]}`, 302);
    }
    const entry = listings.get(parts[1] ?? "");
    if (!entry) {
      return errorEnvelope(404, "listing_not_found", "listing not found");
    }
    if (parts[0] === "catalog" && parts.length === 2 && req.method === "GET") {
      return Response.json({ listing: entry.listing });
    }
    if (parts[0] === "catalog" && parts[2] === "acquire" && req.method === "POST") {
      if (entry.acquireAnswer) {
        return entry.acquireAnswer();
      }
      const status = entry.acquireStatus ?? 201;
      if (status === 402) {
        return Response.json(
          {
            error: {
              code: "payment_required",
              message: "this listing costs 500 usd for this buyer; pay the purchase intent",
            },
            intent: PAID_INTENT,
          },
          { status: 402 }
        );
      }
      if (status >= 400) {
        return errorEnvelope(status, "listing_unavailable", "this listing cannot be acquired");
      }
      return Response.json(
        {
          entitled: true,
          source: status === 200 ? "purchase" : "free",
          license: { key: licenseKeyFor(parts[1]), listingId: parts[1], edition: 1 },
        },
        { status }
      );
    }
    if (parts[0] === "catalog" && parts[2] === "bundle") {
      return Response.json({ bundle: entry.bundle, requires: [] });
    }
    if (parts[0] === "modules" && parts[2] === "download") {
      if (entry.downloadRefusal) {
        return entry.downloadRefusal();
      }
      const base = `http://127.0.0.1:${server.port}`;
      if (entry.download) {
        return Response.json(entry.download(base));
      }
      const archive = entry.archive ?? new Uint8Array();
      return Response.json({
        url: `${base}/files/${parts[1]}`,
        expiresAt: "2030-01-01T00:00:00Z",
        sha256: sha256(archive),
        sizeBytes: archive.byteLength,
      });
    }
    return errorEnvelope(404, "not_found", "no such route");
  },
});

const BASE = `http://127.0.0.1:${server.port}`;

afterAll(() => {
  server.stop(true);
});

// ---------- archives and listings ----------

function moduleZip(manifest: Record<string, unknown>, extra: Record<string, string> = {}, root = ""): Uint8Array {
  const files: Record<string, Uint8Array> = { [`${root}manifest.json`]: strToU8(JSON.stringify(manifest)) };
  for (const [path, text] of Object.entries(extra)) {
    files[`${root}${path}`] = strToU8(text);
  }
  return zipSync(files);
}

function addModuleListing(
  id: string,
  manifest: Record<string, unknown>,
  options: Partial<FakeListing> & { version?: string; type?: string; edition?: unknown; moduleKey?: unknown } = {}
): Uint8Array {
  const archive = options.archive ?? moduleZip(manifest, { "main.js": "export default 1;" });
  archives.set(id, archive);
  listings.set(id, {
    listing: {
      id,
      type: options.type ?? "module",
      name: `${id} name`,
      version: options.version ?? "1.2.0",
      ...(options.edition === undefined ? {} : { edition: options.edition }),
      ...(options.moduleKey === undefined ? {} : { moduleKey: options.moduleKey }),
    },
    archive,
    acquireStatus: options.acquireStatus,
    acquireAnswer: options.acquireAnswer,
    downloadRefusal: options.downloadRefusal,
    download: options.download,
  });
  return archive;
}

const OBS_MANIFEST = {
  id: "obs_scenes",
  name: "OBS Scenes",
  version: "1.2.0",
  permissions: ["obs.control", "storage"],
  settings: [
    { id: "host", type: "text" },
    { id: "port", type: "number" },
  ],
  local: [{ id: "obs", name: "OBS", protocol: "websocket", hostSetting: "host", portSetting: "port" }],
};

// ---------- a route host ----------

interface Sent {
  event: Record<string, unknown>;
  clientId?: string;
}

interface Host {
  self: Record<string, unknown>;
  /** Every log line, as `[message, fields]`. */
  logs: unknown[][];
  webhooks: Sent[];
  barkloaderUploads: FormData[];
  scenes: Array<Record<string, unknown>>;
}

function host(
  options: {
    installed?: Record<string, { moduleId: string; name: string; version: string }>;
    modulesById?: Record<string, Record<string, unknown>>;
  } = {}
): Host {
  const webhooks: Sent[] = [];
  const barkloaderUploads: FormData[] = [];
  const scenes: Array<Record<string, unknown>> = [];
  const logs: unknown[][] = [];
  const log = (...line: unknown[]) => {
    logs.push(line);
  };
  const logger = { debug: log, info: log, warn: log, error: log };
  const self = {
    logger,
    installId: { get: async () => INSTALL_ID },
    marketplace: new MarketplaceClient({ baseUrl: BASE, downloadHosts: [BASE] }),
    webhookClient: {
      async send(event: Record<string, unknown>, clientId?: string) {
        webhooks.push({ event, clientId });
      },
    },
    db: {
      async getModuleByModuleKey(moduleKey: string) {
        return options.installed?.[moduleKey] ?? null;
      },
      async findModuleByModuleId(moduleId: string) {
        return options.modulesById?.[moduleId] ?? null;
      },
      async createScene(req: Record<string, unknown>) {
        scenes.push(req);
        return { id: `scene-${scenes.length}`, ...req };
      },
    },
    async barkloaderRequest(path: string, init?: RequestInit) {
      expect(path).toBe("/functions");
      barkloaderUploads.push(init?.body as FormData);
      return Response.json({ message: "accepted" });
    },
    async emitSceneWebhook() {},
  };
  return { self, logs, webhooks, barkloaderUploads, scenes };
}

function install(h: Host, listingId: string, request: MarketplaceInstallRequest): Promise<MarketplaceInstallResult> {
  const route = marketplaceRoutes.installMarketplaceListing as unknown as (
    id: string,
    r: MarketplaceInstallRequest,
    c: { clientId: string }
  ) => Promise<MarketplaceInstallResult>;
  return route.call(h.self, listingId, request, { clientId: "client-1" });
}

function inspect(h: Host, listingId: string, buyerToken?: string): Promise<MarketplaceListingInspection> {
  const route = marketplaceRoutes.inspectMarketplaceListing as unknown as (
    id: string,
    t?: string
  ) => Promise<MarketplaceListingInspection>;
  return route.call(h.self, listingId, buyerToken);
}

function installBundle(h: Host, listingId: string, buyerToken?: string): Promise<MarketplaceBundleInstallResult> {
  const route = marketplaceRoutes.installMarketplaceBundle as unknown as (
    id: string,
    t?: string
  ) => Promise<MarketplaceBundleInstallResult>;
  return route.call(h.self, listingId, buyerToken);
}

const APPROVED: MarketplaceInstallRequest = {
  approvedPermissions: ["obs.control", "storage"],
  approvedLocalEndpoints: ["obs"],
};

function requestsTo(prefix: string): Seen[] {
  return seen.filter((s) => s.path.startsWith(prefix));
}

beforeEach(() => {
  listings.clear();
  archives.clear();
  seen.length = 0;
});

// ---------- tests ----------

describe("marketplaceModuleKey", () => {
  const hash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  test("is module id, version and the first 7 hex of the archive's sha256", () => {
    expect(marketplaceModuleKey("obs_scenes", "1.2.0", hash)).toBe("obs_scenes:1.2.0:0123456");
  });

  test("an edition 1 listing installs under the key it always had: its listing id is its module id", async () => {
    const archive = addModuleListing("obs_scenes", OBS_MANIFEST, { moduleKey: "obs_scenes", edition: 1 });
    const result = await install(host(), "obs_scenes", APPROVED);
    expect(result).toEqual({ status: "installed", moduleKey: `obs_scenes:1.2.0:${sha256(archive).slice(0, 7)}` });
  });

  test("a later edition installs under its module id, not its listing id", async () => {
    const archive = addModuleListing(
      "obs_scenes-v2",
      { ...OBS_MANIFEST, version: "2.0.0" },
      { version: "2.0.0", edition: 2, moduleKey: "obs_scenes" }
    );
    const result = await install(host(), "obs_scenes-v2", APPROVED);
    expect(result).toEqual({ status: "installed", moduleKey: `obs_scenes:2.0.0:${sha256(archive).slice(0, 7)}` });
  });
});

describe("installMarketplaceListing", () => {
  test("claims a free listing anonymously and installs it with the key, under the pinned key", async () => {
    const archive = addModuleListing("obs_scenes", OBS_MANIFEST);
    const h = host();

    const result = await install(h, "obs_scenes", APPROVED);

    const moduleKey = `obs_scenes:1.2.0:${sha256(archive).slice(0, 7)}`;
    expect(result).toEqual({ status: "installed", moduleKey });
    expect(h.barkloaderUploads).toHaveLength(1);
    const upload = h.barkloaderUploads[0];
    expect(upload.get("module_key")).toBe(moduleKey);
    expect(upload.get("client_id")).toBe("client-1");
    const file = upload.get("file") as File;
    expect(file.name).toBe("obs_scenes name-1.2.0.zip");
    expect(sha256(new Uint8Array(await file.arrayBuffer()))).toBe(sha256(archive));
    expect(h.webhooks).toEqual([]);
    expect(requestsTo("/catalog/obs_scenes/acquire")).toHaveLength(1);
    expect(requestsTo("/modules/obs_scenes/download")).toEqual([
      {
        method: "GET",
        path: "/modules/obs_scenes/download",
        authorization: null,
        licenseKey: licenseKeyFor("obs_scenes"),
        installId: INSTALL_ID,
      },
    ]);
    expect(seen.every((s) => s.authorization === null)).toBe(true);
    expect(requestsTo("/files/")[0].licenseKey).toBeNull();
  });

  test("records the listing and edition 1 on the module when the listing names no edition", async () => {
    addModuleListing("obs_scenes", OBS_MANIFEST);
    const h = host();

    await install(h, "obs_scenes", APPROVED);

    const upload = h.barkloaderUploads[0];
    expect(upload.get("marketplace_listing_id")).toBe("obs_scenes");
    expect(upload.get("marketplace_edition")).toBe("1");
  });

  test("installs a later edition under the manifest id key, recording its own listing id and edition", async () => {
    const archive = addModuleListing(
      "obs_scenes-v2",
      { ...OBS_MANIFEST, version: "2.0.0" },
      { version: "2.0.0", edition: 2, moduleKey: "obs_scenes" }
    );
    const h = host();

    const result = await install(h, "obs_scenes-v2", APPROVED);

    const moduleKey = `obs_scenes:2.0.0:${sha256(archive).slice(0, 7)}`;
    expect(result).toEqual({ status: "installed", moduleKey });
    const upload = h.barkloaderUploads[0];
    expect(upload.get("module_key")).toBe(moduleKey);
    expect(upload.get("marketplace_listing_id")).toBe("obs_scenes-v2");
    expect(upload.get("marketplace_edition")).toBe("2");
  });

  test("installs a later edition over an installed earlier one as an upgrade", async () => {
    const edition1 = addModuleListing("obs_scenes", OBS_MANIFEST, { moduleKey: "obs_scenes", edition: 1 });
    const edition1Key = `obs_scenes:1.2.0:${sha256(edition1).slice(0, 7)}`;
    const edition2 = addModuleListing(
      "obs_scenes-v2",
      { ...OBS_MANIFEST, version: "2.0.0" },
      { version: "2.0.0", edition: 2, moduleKey: "obs_scenes" }
    );
    const h = host({ installed: { [edition1Key]: { moduleId: "obs_scenes", name: "OBS Scenes", version: "1.2.0" } } });

    const result = await install(h, "obs_scenes-v2", APPROVED);

    const moduleKey = `obs_scenes:2.0.0:${sha256(edition2).slice(0, 7)}`;
    expect(result).toEqual({ status: "installed", moduleKey });
    expect(h.barkloaderUploads).toHaveLength(1);
    expect(h.barkloaderUploads[0].get("marketplace_listing_id")).toBe("obs_scenes-v2");
    expect(h.webhooks).toEqual([]);
  });

  test("answers a later edition that is already installed as installed", async () => {
    const archive = addModuleListing(
      "obs_scenes-v2",
      { ...OBS_MANIFEST, version: "2.0.0" },
      { version: "2.0.0", edition: 2, moduleKey: "obs_scenes" }
    );
    const moduleKey = `obs_scenes:2.0.0:${sha256(archive).slice(0, 7)}`;
    const h = host({ installed: { [moduleKey]: { moduleId: "obs_scenes", name: "OBS Scenes", version: "2.0.0" } } });

    const result = await install(h, "obs_scenes-v2", APPROVED);

    expect(result).toEqual({ status: "installed", moduleKey, alreadyInstalled: true });
    expect(h.barkloaderUploads).toEqual([]);
  });

  test("refuses an archive whose manifest id is not the listing's module id, and reports the failure", async () => {
    const archive = addModuleListing(
      "obs_scenes-v2",
      { ...OBS_MANIFEST, id: "obs_scenes_two", version: "2.0.0" },
      { version: "2.0.0", edition: 2, moduleKey: "obs_scenes" }
    );
    const h = host();

    await expect(install(h, "obs_scenes-v2", APPROVED)).rejects.toThrow(
      'Marketplace listing obs_scenes-v2 is module "obs_scenes", but its archive\'s manifest id is "obs_scenes_two"'
    );

    expect(h.barkloaderUploads).toEqual([]);
    expect(h.webhooks).toHaveLength(1);
    expect(h.webhooks[0].event).toMatchObject({
      type: "module.install_failed",
      moduleKey: `obs_scenes:2.0.0:${sha256(archive).slice(0, 7)}`,
      source: "marketplace",
    });
  });

  test("checks a listing without a moduleKey against its listing id", async () => {
    addModuleListing("obs_scenes", { ...OBS_MANIFEST, id: "something_else" });
    await expect(install(host(), "obs_scenes", APPROVED)).rejects.toThrow(
      'is module "obs_scenes", but its archive\'s manifest id is "something_else"'
    );
  });

  test("refuses a listing whose moduleKey is not a non-blank string", async () => {
    for (const moduleKey of ["", 7]) {
      addModuleListing("obs_scenes", OBS_MANIFEST, { moduleKey });
      await expect(install(host(), "obs_scenes", APPROVED)).rejects.toThrow("has an invalid moduleKey");
    }
  });

  test("refuses a listing whose edition is not a whole number of 1 or more", async () => {
    for (const edition of [0, 1.5, "2", null]) {
      addModuleListing("obs_scenes", OBS_MANIFEST, { edition });
      const h = host();
      if (edition === null) {
        // null reads as absent, the same as a listing that predates editions.
        await install(h, "obs_scenes", APPROVED);
        expect(h.barkloaderUploads[0].get("marketplace_edition")).toBe("1");
        continue;
      }
      await expect(install(h, "obs_scenes", APPROVED)).rejects.toThrow("invalid edition");
      expect(h.barkloaderUploads).toEqual([]);
    }
  });

  test("claims the listing with the buyer token, and sends it only where the marketplace accepts it", async () => {
    addModuleListing("obs_scenes", OBS_MANIFEST);
    const h = host();

    const result = await install(h, "obs_scenes", { ...APPROVED, buyerToken: "buyer.jws.token" });

    expect(result.status).toBe("installed");
    expect(requestsTo("/catalog/obs_scenes/acquire")).toEqual([
      {
        method: "POST",
        path: "/catalog/obs_scenes/acquire",
        authorization: "Bearer buyer.jws.token",
        licenseKey: null,
        installId: null,
      },
    ]);
    expect(requestsTo("/modules/obs_scenes/download")[0].authorization).toBe("Bearer buyer.jws.token");
    expect(seen.find((s) => s.path === "/catalog/obs_scenes")?.authorization).toBeNull();
    expect(requestsTo("/files/")[0].authorization).toBeNull();
  });

  test("answers payment_required with the purchase intent on 402 and downloads nothing", async () => {
    addModuleListing("paid_mod", OBS_MANIFEST, { acquireStatus: 402 });
    const h = host();

    const result = await install(h, "paid_mod", { ...APPROVED, buyerToken: "t" });

    expect(result).toEqual({
      status: "payment_required",
      name: "paid_mod name",
      version: "1.2.0",
      intent: PAID_INTENT,
    });
    expect(requestsTo("/modules/")).toEqual([]);
    expect(h.barkloaderUploads).toEqual([]);
  });

  test("throws on any other acquire refusal", async () => {
    addModuleListing("gone", OBS_MANIFEST, { acquireStatus: 409 });
    await expect(install(host(), "gone", { ...APPROVED, buyerToken: "t" })).rejects.toThrow(
      "marketplace_http status=409 code=listing_unavailable: this listing cannot be acquired"
    );
  });

  test("refuses an archive whose sha256 differs, and reports the failure", async () => {
    addModuleListing("obs_scenes", OBS_MANIFEST, {
      download: (base) => ({ url: `${base}/files/obs_scenes`, sha256: "f".repeat(64) }),
    });
    const h = host();

    await expect(install(h, "obs_scenes", APPROVED)).rejects.toThrow("does not match its expected sha256");
    expect(h.barkloaderUploads).toEqual([]);
    expect(h.webhooks).toHaveLength(1);
    expect(h.webhooks[0].clientId).toBe("client-1");
    expect(h.webhooks[0].event).toMatchObject({
      type: "module.install_failed",
      modulePrefix: "obs_scenes",
      moduleKey: "obs_scenes:1.2.0:fffffff",
      source: "marketplace",
    });
  });

  test("refuses an archive whose length differs from sizeBytes", async () => {
    addModuleListing("obs_scenes", OBS_MANIFEST, {
      download: (base) => {
        const archive = archives.get("obs_scenes") as Uint8Array;
        return { url: `${base}/files/obs_scenes`, sha256: sha256(archive), sizeBytes: archive.byteLength + 1 };
      },
    });
    const h = host();

    await expect(install(h, "obs_scenes", APPROVED)).rejects.toThrow("were expected");
    expect(h.barkloaderUploads).toEqual([]);
  });

  test("refuses a download without a sha256 before fetching anything", async () => {
    addModuleListing("legacy", OBS_MANIFEST, {
      download: (base) => ({ url: `${base}/files/legacy`, expiresAt: "2030-01-01T00:00:00Z" }),
    });
    const h = host();

    await expect(install(h, "legacy", APPROVED)).rejects.toThrow("did not return a valid sha256");
    expect(requestsTo("/files/")).toEqual([]);
    expect(h.barkloaderUploads).toEqual([]);
  });

  test("refuses a download on a host outside the allowlist without fetching it", async () => {
    addModuleListing("obs_scenes", OBS_MANIFEST, {
      download: () => {
        const archive = archives.get("obs_scenes") as Uint8Array;
        return { url: `http://localhost:${server.port}/files/obs_scenes`, sha256: sha256(archive) };
      },
    });
    const h = host();

    await expect(install(h, "obs_scenes", APPROVED)).rejects.toThrow("is not an allowed download host");
    expect(requestsTo("/files/")).toEqual([]);
    expect(h.barkloaderUploads).toEqual([]);
  });

  test("does not follow a redirect off an allowed host", async () => {
    addModuleListing("obs_scenes", OBS_MANIFEST, {
      download: (base) => {
        const archive = archives.get("obs_scenes") as Uint8Array;
        return { url: `${base}/redirect/obs_scenes`, sha256: sha256(archive) };
      },
    });

    await expect(install(host(), "obs_scenes", APPROVED)).rejects.toThrow("Redirect");
    expect(requestsTo("/files/")).toEqual([]);
  });

  test("answers needs_approval for unapproved permissions and local endpoints, installing nothing", async () => {
    addModuleListing("obs_scenes", OBS_MANIFEST);
    const h = host();

    const result = await install(h, "obs_scenes", { approvedPermissions: ["storage"], approvedLocalEndpoints: [] });

    expect(result).toEqual({
      status: "needs_approval",
      name: "obs_scenes name",
      version: "1.2.0",
      unapproved: ["obs.control"],
      unapprovedLocalEndpoints: ["obs"],
    });
    expect(h.barkloaderUploads).toEqual([]);
    expect(h.webhooks).toEqual([]);
  });

  test("answers an installed key with module.installed instead of reinstalling", async () => {
    const archive = addModuleListing("obs_scenes", OBS_MANIFEST);
    const moduleKey = `obs_scenes:1.2.0:${sha256(archive).slice(0, 7)}`;
    const h = host({ installed: { [moduleKey]: { moduleId: "obs_scenes", name: "OBS Scenes", version: "1.2.0" } } });

    const result = await install(h, "obs_scenes", APPROVED);

    expect(result).toEqual({ status: "installed", moduleKey, alreadyInstalled: true });
    expect(h.barkloaderUploads).toEqual([]);
    expect(h.webhooks).toEqual([
      {
        clientId: "client-1",
        event: {
          type: "module.installed",
          modulePrefix: "obs_scenes",
          moduleName: "OBS Scenes",
          version: "1.2.0",
          moduleKey,
          alreadyInstalled: true,
          source: "marketplace",
        },
      },
    ]);
  });

  test("refuses a listing that is not a module or theme", async () => {
    listings.set("pack", { listing: { id: "pack", type: "emote", name: "Pack", version: "1" } });
    await expect(install(host(), "pack", APPROVED)).rejects.toThrow(
      "is a emote listing and does not install as a module"
    );
  });

  test("refuses to run with marketplace installs turned off", async () => {
    const h = host();
    h.self.marketplace = null;
    await expect(install(h, "obs_scenes", APPROVED)).rejects.toThrow("turned off");
  });
});

describe("MarketplaceClient.acquire", () => {
  const client = () => new MarketplaceClient({ baseUrl: BASE, downloadHosts: [BASE] });
  const refusal = (status: number, code: string) => () => errorEnvelope(status, code, `${code} refusal`);

  const answers: Array<{
    name: string;
    listing: Partial<FakeListing>;
    expected: unknown;
  }> = [
    {
      name: "a free claim (201) answers the license",
      listing: { acquireStatus: 201 },
      expected: {
        status: "entitled",
        source: "free",
        license: { key: licenseKeyFor("mod"), listingId: "mod", edition: 1 },
      },
    },
    {
      name: "a listing already held (200) answers the license",
      listing: { acquireStatus: 200 },
      expected: {
        status: "entitled",
        source: "purchase",
        license: { key: licenseKeyFor("mod"), listingId: "mod", edition: 1 },
      },
    },
    {
      name: "a marketplace that issues no keys answers a null license",
      listing: { acquireAnswer: () => Response.json({ entitled: true, source: "free" }, { status: 201 }) },
      expected: { status: "entitled", source: "free", license: null },
    },
    {
      name: "402 answers payment_required with the intent",
      listing: { acquireStatus: 402 },
      expected: { status: "payment_required", intent: PAID_INTENT },
    },
    {
      name: "402 from a marketplace that opens no intent answers a null intent",
      listing: { acquireAnswer: refusal(402, "payment_required") },
      expected: { status: "payment_required", intent: null },
    },
  ];
  for (const answer of answers) {
    test(answer.name, async () => {
      addModuleListing("mod", OBS_MANIFEST, answer.listing);
      expect(await client().acquire("mod", "buyer-token")).toEqual(answer.expected as never);
    });
  }

  const refusals: Array<{ status: number; code: string }> = [
    { status: 401, code: "account_required" },
    { status: 403, code: "entitlement_revoked" },
    { status: 409, code: "listing_unavailable" },
    { status: 410, code: "downloads_blocked" },
    { status: 429, code: "rate_limited" },
  ];
  for (const { status, code } of refusals) {
    test(`${status} ${code} throws a MarketplaceError with that status and code`, async () => {
      addModuleListing("mod", OBS_MANIFEST, { acquireAnswer: refusal(status, code) });
      const err = await client()
        .acquire("mod")
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MarketplaceError);
      expect(err).toMatchObject({ status, code, detail: `${code} refusal` });
    });
  }

  test("claims anonymously without a token, sending no Authorization header", async () => {
    addModuleListing("mod", OBS_MANIFEST);
    await client().acquire("mod");
    expect(requestsTo("/catalog/mod/acquire")).toEqual([
      { method: "POST", path: "/catalog/mod/acquire", authorization: null, licenseKey: null, installId: null },
    ]);
  });

  const malformed: Array<{ name: string; body: Record<string, unknown>; status: number; message: string }> = [
    {
      name: "a license without a key",
      body: { entitled: true, source: "free", license: { listingId: "mod", edition: 1 } },
      status: 201,
      message: "malformed license",
    },
    {
      name: "a license for another listing",
      body: { entitled: true, source: "free", license: { key: "k", listingId: "other", edition: 1 } },
      status: 201,
      message: "malformed license",
    },
    {
      name: "a license of edition 0",
      body: { entitled: true, source: "free", license: { key: "k", listingId: "mod", edition: 0 } },
      status: 201,
      message: "invalid edition",
    },
    {
      name: "an intent of an unknown kind",
      body: { error: { code: "payment_required", message: "pay" }, intent: { ...PAID_INTENT, kind: "rental" } },
      status: 402,
      message: "malformed purchase intent",
    },
  ];
  for (const { name, body, status, message } of malformed) {
    test(`refuses ${name}`, async () => {
      addModuleListing("mod", OBS_MANIFEST, { acquireAnswer: () => Response.json(body, { status }) });
      await expect(client().acquire("mod", "t")).rejects.toThrow(message);
    });
  }
});

describe("MarketplaceClient.getModuleDownload", () => {
  const client = () => new MarketplaceClient({ baseUrl: BASE, downloadHosts: [BASE] });

  test("sends the license key, the install id and the buyer token", async () => {
    addModuleListing("mod", OBS_MANIFEST);
    await client().getModuleDownload("mod", { buyerToken: "t", license: { key: "W3X-1", installId: INSTALL_ID } });
    expect(requestsTo("/modules/mod/download")).toEqual([
      {
        method: "GET",
        path: "/modules/mod/download",
        authorization: "Bearer t",
        licenseKey: "W3X-1",
        installId: INSTALL_ID,
      },
    ]);
  });

  test("sends no license headers without a license", async () => {
    addModuleListing("mod", OBS_MANIFEST);
    await client().getModuleDownload("mod");
    expect(requestsTo("/modules/mod/download")[0]).toMatchObject({
      authorization: null,
      licenseKey: null,
      installId: null,
    });
  });

  test("refuses a license with a blank key or install id before asking", async () => {
    addModuleListing("mod", OBS_MANIFEST);
    await expect(client().getModuleDownload("mod", { license: { key: "W3X-1", installId: "" } })).rejects.toThrow(
      "needs both a license key and an install id"
    );
    expect(requestsTo("/modules/")).toEqual([]);
  });

  const refusals: Array<{ status: number; code: string }> = [
    { status: 400, code: "install_id_required" },
    { status: 401, code: "account_required" },
    { status: 403, code: "not_entitled" },
    { status: 403, code: "buyer_mismatch" },
    { status: 409, code: "activation_limit" },
    { status: 410, code: "downloads_blocked" },
  ];
  for (const { status, code } of refusals) {
    test(`${status} ${code} throws a MarketplaceError with that status and code`, async () => {
      addModuleListing("mod", OBS_MANIFEST, { downloadRefusal: () => errorEnvelope(status, code, `${code} refusal`) });
      const err = await client()
        .getModuleDownload("mod", { license: { key: "W3X-1", installId: INSTALL_ID } })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MarketplaceError);
      expect(err).toMatchObject({ status, code, detail: `${code} refusal` });
    });
  }
});

describe("installMarketplaceListing with license keys", () => {
  test("downloads with a given key and claims nothing", async () => {
    addModuleListing("obs_scenes", OBS_MANIFEST);
    const h = host();

    const result = await install(h, "obs_scenes", { ...APPROVED, buyerToken: "t", licenseKey: "W3X-GIVEN" });

    expect(result.status).toBe("installed");
    expect(requestsTo("/catalog/obs_scenes/acquire")).toEqual([]);
    expect(requestsTo("/modules/obs_scenes/download")[0]).toMatchObject({
      authorization: "Bearer t",
      licenseKey: "W3X-GIVEN",
      installId: INSTALL_ID,
    });
  });

  test("downloads with the key its own claim answered with, for the buyer", async () => {
    addModuleListing("obs_scenes", OBS_MANIFEST, { acquireStatus: 200 });

    await install(host(), "obs_scenes", { ...APPROVED, buyerToken: "t" });

    expect(requestsTo("/modules/obs_scenes/download")[0]).toMatchObject({
      authorization: "Bearer t",
      licenseKey: licenseKeyFor("obs_scenes"),
      installId: INSTALL_ID,
    });
  });

  test("downloads without a key from a marketplace that issues none", async () => {
    addModuleListing("obs_scenes", OBS_MANIFEST, {
      acquireAnswer: () => Response.json({ entitled: true, source: "free" }, { status: 201 }),
    });

    expect((await install(host(), "obs_scenes", APPROVED)).status).toBe("installed");
    expect(requestsTo("/modules/obs_scenes/download")[0]).toMatchObject({ licenseKey: null, installId: null });
  });

  test("downloads anonymously without a key from a marketplace that refuses anonymous claims", async () => {
    addModuleListing("obs_scenes", OBS_MANIFEST, {
      acquireAnswer: () => errorEnvelope(401, "unauthorized", "a valid bearer token is required for this request"),
    });

    expect((await install(host(), "obs_scenes", APPROVED)).status).toBe("installed");
    expect(requestsTo("/modules/obs_scenes/download")[0]).toMatchObject({
      authorization: null,
      licenseKey: null,
      installId: null,
    });
  });

  test("still refuses a buyer's claim the marketplace answers 401 unauthorized", async () => {
    addModuleListing("obs_scenes", OBS_MANIFEST, {
      acquireAnswer: () => errorEnvelope(401, "unauthorized", "a valid bearer token is required for this request"),
    });
    await expect(install(host(), "obs_scenes", { ...APPROVED, buyerToken: "expired" })).rejects.toThrow(
      "marketplace_http status=401 code=unauthorized"
    );
    expect(requestsTo("/modules/")).toEqual([]);
  });

  test("answers a paid listing claimed without an account with account_required", async () => {
    addModuleListing("paid_mod", OBS_MANIFEST, {
      acquireAnswer: () => errorEnvelope(401, "account_required", "this listing is paid; sign in to buy it"),
    });
    await expect(install(host(), "paid_mod", APPROVED)).rejects.toThrow(
      "marketplace_http status=401 code=account_required: this listing is paid; sign in to buy it"
    );
    expect(requestsTo("/modules/")).toEqual([]);
  });

  const downloadRefusals: Array<{ status: number; code: string; message: string }> = [
    {
      status: 409,
      code: "activation_limit",
      message: "this license key has been used on as many installs as it allows; ask the marketplace to reset it",
    },
    { status: 403, code: "not_entitled", message: "this license key does not unlock this listing" },
    {
      status: 401,
      code: "account_required",
      message: "this license key belongs to an account; present that account's token",
    },
    { status: 410, code: "downloads_blocked", message: "this module's downloads have been blocked by the marketplace" },
  ];
  for (const refusal of downloadRefusals) {
    test(`reports a ${refusal.code} download in a form the caller can read the code back from`, async () => {
      addModuleListing("obs_scenes", OBS_MANIFEST, {
        downloadRefusal: () => errorEnvelope(refusal.status, refusal.code, refusal.message),
      });
      const h = host();

      const err = await install(h, "obs_scenes", { ...APPROVED, licenseKey: "W3X-GIVEN" }).catch((e: unknown) => e);

      expect(parseMarketplaceCatalogError((err as Error).message)).toEqual({ kind: "http", ...refusal });
      expect(h.barkloaderUploads).toEqual([]);
    });
  }

  test("never logs the license key", async () => {
    addModuleListing("obs_scenes", OBS_MANIFEST);
    const h = host();

    await install(h, "obs_scenes", { ...APPROVED, licenseKey: "W3X-SECRET-KEY" });
    await install(h, "obs_scenes", APPROVED);

    const logged = JSON.stringify(h.logs);
    expect(logged).not.toContain("W3X-SECRET-KEY");
    expect(logged).not.toContain(licenseKeyFor("obs_scenes"));
    expect(logged).toContain('"hasLicense":true');
  });

  test("hands barkloader the key it downloaded with, beside the provenance", async () => {
    addModuleListing("obs_scenes", OBS_MANIFEST);
    const h = host();

    await install(h, "obs_scenes", APPROVED);

    const upload = h.barkloaderUploads[0];
    expect(upload.get("marketplace_listing_id")).toBe("obs_scenes");
    expect(upload.get("marketplace_license_key")).toBe(licenseKeyFor("obs_scenes"));
  });

  test("hands barkloader no key when it downloaded without one", async () => {
    addModuleListing("obs_scenes", OBS_MANIFEST, {
      acquireAnswer: () => Response.json({ entitled: true, source: "free" }, { status: 201 }),
    });
    const h = host();

    await install(h, "obs_scenes", APPROVED);

    expect(h.barkloaderUploads[0].get("marketplace_license_key")).toBeNull();
  });

  test("refuses a licenseKey that is not a string", async () => {
    addModuleListing("obs_scenes", OBS_MANIFEST);
    await expect(install(host(), "obs_scenes", { ...APPROVED, licenseKey: 7 as unknown as string })).rejects.toThrow(
      "licenseKey must be a string"
    );
  });
});

describe("getInstalledModuleLicense", () => {
  function licenseOf(h: Host, moduleId: string): Promise<unknown> {
    const route = marketplaceRoutes.getInstalledModuleLicense as unknown as (id: string) => Promise<unknown>;
    return route.call(h.self, moduleId);
  }

  test("answers the stored key and the listing it unlocks", async () => {
    const h = host({
      modulesById: {
        obs_scenes: { moduleId: "obs_scenes", marketplaceListingId: "obs_scenes-v2", marketplaceLicenseKey: "W3X-1" },
      },
    });
    expect(await licenseOf(h, "obs_scenes")).toEqual({ listingId: "obs_scenes-v2", key: "W3X-1" });
  });

  test("answers null for a module with no key", async () => {
    const h = host({
      modulesById: {
        from_marketplace: { moduleId: "from_marketplace", marketplaceListingId: "from_marketplace" },
        uploaded: { moduleId: "uploaded", uploadResourceId: "res-1" },
      },
    });
    expect(await licenseOf(h, "from_marketplace")).toBeNull();
    expect(await licenseOf(h, "uploaded")).toBeNull();
  });

  test("refuses a module that is not installed, and a blank id", async () => {
    await expect(licenseOf(host(), "ghost")).rejects.toThrow("module ghost is not installed");
    await expect(licenseOf(host(), "")).rejects.toThrow("moduleId is required");
  });
});

describe("inspectMarketplaceListing", () => {
  test("reports the verified build's manifest, permissions, local endpoints and files", async () => {
    const archive = moduleZip(OBS_MANIFEST, { "main.js": "x", "README.md": "# hi", "__MACOSX/junk": "j" }, "obs/");
    addModuleListing("obs_scenes", OBS_MANIFEST, { archive });

    const result = await inspect(host(), "obs_scenes");

    expect(result).toEqual({
      listingId: "obs_scenes",
      moduleId: "obs_scenes",
      edition: 1,
      type: "module",
      name: "obs_scenes name",
      version: "1.2.0",
      moduleKey: `obs_scenes:1.2.0:${sha256(archive).slice(0, 7)}`,
      sha256: sha256(archive),
      sizeBytes: archive.byteLength,
      manifest: { id: "obs_scenes", name: "OBS Scenes", version: "1.2.0", description: "" },
      permissions: ["obs.control", "storage"],
      localEndpoints: [{ id: "obs", name: "OBS", protocol: "websocket" }],
      files: [
        { path: "README.md", size: 4 },
        { path: "main.js", size: 1 },
        { path: "manifest.json", size: JSON.stringify(OBS_MANIFEST).length },
      ],
    });
    expect(requestsTo("/catalog/obs_scenes/acquire")).toEqual([]);
    expect(requestsTo("/modules/obs_scenes/download")[0]).toMatchObject({ licenseKey: null, installId: null });
  });

  test("reports a later edition's listing id, module id and the key it installs under", async () => {
    const archive = addModuleListing(
      "obs_scenes-v2",
      { ...OBS_MANIFEST, version: "2.0.0" },
      { version: "2.0.0", edition: 2, moduleKey: "obs_scenes" }
    );

    const result = await inspect(host(), "obs_scenes-v2");

    expect(result).toMatchObject({
      listingId: "obs_scenes-v2",
      moduleId: "obs_scenes",
      edition: 2,
      moduleKey: `obs_scenes:2.0.0:${sha256(archive).slice(0, 7)}`,
    });
  });

  test("refuses a build whose manifest id is not the listing's module id", async () => {
    addModuleListing("obs_scenes-v2", OBS_MANIFEST, { edition: 2, moduleKey: "obs" });
    await expect(inspect(host(), "obs_scenes-v2")).rejects.toThrow('is module "obs"');
  });
});

describe("installMarketplaceBundle", () => {
  test("creates a scene from an overlay listing", async () => {
    listings.set("cozy", {
      listing: { id: "cozy", type: "overlay", name: "Cozy", description: "warm", version: "1" },
      bundle: { layout: { width: 1920, height: 1080 }, widgets: [{ id: "w1" }] },
    });
    const h = host();

    const result = await installBundle(h, "cozy");

    expect(result).toEqual({ status: "installed", listingId: "cozy", engineId: "scene-1", kind: "scene" });
    expect(h.scenes[0]).toMatchObject({
      name: "Cozy",
      description: "warm",
      kind: "scene",
      layoutJson: JSON.stringify({ width: 1920, height: 1080 }),
      widgetsJson: JSON.stringify([{ id: "w1" }]),
    });
  });

  test("creates an alert composition from an alert listing, after claiming it", async () => {
    listings.set("boom", {
      listing: { id: "boom", type: "alert", name: "Boom", version: "2" },
      bundle: { layout: {}, widgets: [], behaviors: { b1: { kind: "fade" } }, inputs: [{ id: "who" }] },
    });
    const h = host();

    const result = await installBundle(h, "boom", "buyer-token");

    expect(result).toEqual({ status: "installed", listingId: "boom", engineId: "scene-1", kind: "alert" });
    expect(h.scenes[0]).toMatchObject({
      kind: "alert",
      behaviorsJson: JSON.stringify({ b1: { kind: "fade" } }),
      inputsJson: JSON.stringify([{ id: "who" }]),
    });
    expect(requestsTo("/catalog/boom/acquire")[0].authorization).toBe("Bearer buyer-token");
    expect(requestsTo("/catalog/boom/bundle")[0].authorization).toBe("Bearer buyer-token");
  });

  test("answers payment_required on 402 and creates nothing", async () => {
    listings.set("pricey", {
      listing: { id: "pricey", type: "overlay", name: "Pricey", version: "1" },
      acquireStatus: 402,
      bundle: { layout: {}, widgets: [] },
    });
    const h = host();

    expect(await installBundle(h, "pricey", "t")).toEqual({ status: "payment_required", name: "Pricey", version: "1" });
    expect(h.scenes).toEqual([]);
    expect(requestsTo("/catalog/pricey/bundle")).toEqual([]);
  });

  test("refuses a module listing", async () => {
    addModuleListing("obs_scenes", OBS_MANIFEST);
    await expect(installBundle(host(), "obs_scenes")).rejects.toThrow("does not install as a bundle");
  });
});

describe("resolveMarketplaceConfig", () => {
  test("defaults to the public marketplace and its R2 download host", () => {
    expect(resolveMarketplaceConfig(undefined, undefined)).toEqual({
      url: DEFAULT_MARKETPLACE_URL,
      downloadHosts: [...DEFAULT_MARKETPLACE_DOWNLOAD_HOSTS],
    });
  });

  test("a blank URL turns marketplace installs off", () => {
    expect(resolveMarketplaceConfig("", undefined)).toBeNull();
    expect(resolveMarketplaceConfig("  ", "a.example")).toBeNull();
  });

  test("reads a comma-separated host list", () => {
    expect(resolveMarketplaceConfig("http://127.0.0.1:9000", " a.example , http://127.0.0.1:9001 ,")).toEqual({
      url: "http://127.0.0.1:9000",
      downloadHosts: ["a.example", "http://127.0.0.1:9001"],
    });
  });

  test("fails fast on malformed values", () => {
    expect(() => resolveMarketplaceConfig("ftp://x", undefined)).toThrow("marketplaceUrl");
    expect(() => resolveMarketplaceConfig(undefined, "https://a.example/path")).toThrow(
      "WOOFX3_MARKETPLACE_DOWNLOAD_HOSTS"
    );
    expect(() => resolveMarketplaceConfig(undefined, "http://minio.internal:9000")).toThrow(
      "http only on a loopback host"
    );
  });
});
