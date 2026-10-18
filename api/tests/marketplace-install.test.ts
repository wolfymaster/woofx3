import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type {
  MarketplaceBundleInstallResult,
  MarketplaceInstallRequest,
  MarketplaceInstallResult,
  MarketplaceListingInspection,
} from "@woofx3/api";
import { strToU8, zipSync } from "fflate";
import { resolveMarketplaceConfig } from "../src/config";
import {
  DEFAULT_MARKETPLACE_DOWNLOAD_HOSTS,
  DEFAULT_MARKETPLACE_URL,
  MarketplaceClient,
} from "../src/marketplace-client";
import { marketplaceModuleKey, marketplaceRoutes } from "../src/routes/marketplace";

// ---------- a fake marketplace ----------

interface FakeListing {
  listing: Record<string, unknown>;
  /** Answer to POST /catalog/{id}/acquire. */
  acquireStatus?: number;
  /** Answer to GET /modules/{id}/download; built from `archive` when absent. */
  download?: (base: string) => Record<string, unknown>;
  archive?: Uint8Array;
  bundle?: Record<string, unknown>;
}

interface Seen {
  method: string;
  path: string;
  authorization: string | null;
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

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req): Promise<Response> {
    const url = new URL(req.url);
    seen.push({ method: req.method, path: url.pathname, authorization: req.headers.get("authorization") });
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
      const status = entry.acquireStatus ?? 201;
      if (status === 402) {
        return errorEnvelope(402, "payment_required", "this listing costs 500 usd for this buyer; open a checkout");
      }
      if (status >= 400) {
        return errorEnvelope(status, "listing_unavailable", "this listing cannot be acquired");
      }
      return Response.json({ entitled: true, source: status === 200 ? "purchase" : "free" }, { status });
    }
    if (parts[0] === "catalog" && parts[2] === "bundle") {
      return Response.json({ bundle: entry.bundle, requires: [] });
    }
    if (parts[0] === "modules" && parts[2] === "download") {
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
  options: Partial<FakeListing> & { version?: string; type?: string } = {}
): Uint8Array {
  const archive = options.archive ?? moduleZip(manifest, { "main.js": "export default 1;" });
  archives.set(id, archive);
  listings.set(id, {
    listing: { id, type: options.type ?? "module", name: `${id} name`, version: options.version ?? "1.2.0" },
    archive,
    acquireStatus: options.acquireStatus,
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
  webhooks: Sent[];
  barkloaderUploads: FormData[];
  scenes: Array<Record<string, unknown>>;
}

function host(options: { installed?: Record<string, { moduleId: string; name: string; version: string }> } = {}): Host {
  const webhooks: Sent[] = [];
  const barkloaderUploads: FormData[] = [];
  const scenes: Array<Record<string, unknown>> = [];
  const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  const self = {
    logger,
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
  return { self, webhooks, barkloaderUploads, scenes };
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
  test("is listing id, version and the first 7 hex of the archive's sha256", () => {
    const hash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    expect(marketplaceModuleKey("obs_scenes", "1.2.0", hash)).toBe("obs_scenes:1.2.0:0123456");
  });
});

describe("installMarketplaceListing", () => {
  test("installs a free listing anonymously under the pinned key", async () => {
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
    expect(requestsTo("/catalog/obs_scenes/acquire")).toEqual([]);
    expect(seen.every((s) => s.authorization === null)).toBe(true);
  });

  test("claims the listing with the buyer token, and sends it only where the marketplace accepts it", async () => {
    addModuleListing("obs_scenes", OBS_MANIFEST);
    const h = host();

    const result = await install(h, "obs_scenes", { ...APPROVED, buyerToken: "buyer.jws.token" });

    expect(result.status).toBe("installed");
    expect(requestsTo("/catalog/obs_scenes/acquire")).toEqual([
      { method: "POST", path: "/catalog/obs_scenes/acquire", authorization: "Bearer buyer.jws.token" },
    ]);
    expect(requestsTo("/modules/obs_scenes/download")[0].authorization).toBe("Bearer buyer.jws.token");
    expect(seen.find((s) => s.path === "/catalog/obs_scenes")?.authorization).toBeNull();
    expect(requestsTo("/files/")[0].authorization).toBeNull();
  });

  test("answers payment_required on 402 and downloads nothing", async () => {
    addModuleListing("paid_mod", OBS_MANIFEST, { acquireStatus: 402 });
    const h = host();

    const result = await install(h, "paid_mod", { ...APPROVED, buyerToken: "t" });

    expect(result).toEqual({ status: "payment_required", name: "paid_mod name", version: "1.2.0" });
    expect(requestsTo("/modules/")).toEqual([]);
    expect(h.barkloaderUploads).toEqual([]);
  });

  test("throws on any other acquire refusal", async () => {
    addModuleListing("gone", OBS_MANIFEST, { acquireStatus: 409 });
    await expect(install(host(), "gone", { ...APPROVED, buyerToken: "t" })).rejects.toThrow(
      "Marketplace POST /catalog/gone/acquire failed with 409 (listing_unavailable: this listing cannot be acquired)"
    );
  });

  test("refuses an archive whose sha256 differs, and reports the failure", async () => {
    addModuleListing("obs_scenes", OBS_MANIFEST, {
      download: (base) => ({ url: `${base}/files/obs_scenes`, sha256: "f".repeat(64) }),
    });
    const h = host();

    await expect(install(h, "obs_scenes", APPROVED)).rejects.toThrow("does not match the marketplace's sha256");
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

    await expect(install(h, "obs_scenes", APPROVED)).rejects.toThrow("but the marketplace recorded");
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

describe("inspectMarketplaceListing", () => {
  test("reports the verified build's manifest, permissions, local endpoints and files", async () => {
    const archive = moduleZip(OBS_MANIFEST, { "main.js": "x", "README.md": "# hi", "__MACOSX/junk": "j" }, "obs/");
    addModuleListing("obs_scenes", OBS_MANIFEST, { archive });

    const result = await inspect(host(), "obs_scenes");

    expect(result).toEqual({
      listingId: "obs_scenes",
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
  });
});
