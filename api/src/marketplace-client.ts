import { createHash } from "node:crypto";
import type { MarketplaceAuthorQuery, MarketplaceCatalogQuery } from "@woofx3/api";
import { fetchModuleArchive, MODULE_ARCHIVE_FETCH_TIMEOUT_MS, MODULE_ARCHIVE_MAX_BYTES } from "./module-install";

/**
 * A client for the woofx3 marketplace API: catalog reads, the free-claim and
 * purchase check (`acquire`), and module archive and bundle downloads.
 *
 * The engine holds no marketplace credential of its own. A caller acting for
 * a buyer passes that buyer's token, which this client forwards as an opaque
 * bearer. The marketplace accepts one on the install routes (acquire, quote,
 * module download, bundle) and on the catalog browse reads (search, counts,
 * a listing, an author), where a token with the dev claim reveals dev-tier
 * listings. On any other route it answers a buyer token with 401, so the
 * client never sends one there. Without a token every request is anonymous,
 * which is enough for a free, public listing.
 */

/** The public marketplace the engine uses unless `marketplaceUrl` says otherwise. */
export const DEFAULT_MARKETPLACE_URL = "https://marketplace.woofx3.tv";

/**
 * Hosts the public marketplace presigns archive downloads on: its Cloudflare
 * R2 account endpoint, which it addresses path-style
 * (`https://{account}.r2.cloudflarestorage.com/{bucket}/modules/{id}.zip`).
 * Must change with the marketplace's `R2_ACCOUNT_ID`.
 */
export const DEFAULT_MARKETPLACE_DOWNLOAD_HOSTS: readonly string[] = [
  "f35f44146e8730089a795954e32183e8.r2.cloudflarestorage.com",
];

/** How long a marketplace API request may take. */
const MARKETPLACE_REQUEST_TIMEOUT_MS = 10_000;

/** The listing types the marketplace serves. */
export type MarketplaceListingType = "module" | "theme" | "emote" | "overlay" | "alert";

const LISTING_TYPES: ReadonlySet<string> = new Set<MarketplaceListingType>([
  "module",
  "theme",
  "emote",
  "overlay",
  "alert",
]);

/** The fields of `GET /catalog/{id}` an install needs. */
export interface MarketplaceListing {
  id: string;
  type: MarketplaceListingType;
  name: string;
  description: string;
  version: string;
}

/** `GET /modules/{id}/download`, with its integrity fields checked. */
export interface MarketplaceDownload {
  url: string;
  /** Lowercase hex SHA-256 of the archive. Always present: a download without one is refused. */
  sha256: string;
  /** The archive's length in bytes, when the marketplace recorded one. */
  sizeBytes?: number;
}

/** The outcome of `POST /catalog/{id}/acquire`. */
export type MarketplaceAcquireResult = { status: "entitled"; source: string } | { status: "payment_required" };

/**
 * A marketplace API answer that was not a 2xx. `code` is the marketplace's
 * error envelope code (`{"error": {"code", "message"}}`), or empty when the
 * body was not one, and `detail` is the envelope's message, which the
 * marketplace writes for people, or empty.
 */
export class MarketplaceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;

  constructor(message: string, status: number, code: string, detail = "") {
    super(message);
    this.name = "MarketplaceError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/** The marketplace did not answer within the request timeout. */
export class MarketplaceTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketplaceTimeoutError";
  }
}

/** The request never reached the marketplace: DNS, a refused connection, TLS, or a redirect. */
export class MarketplaceUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketplaceUnreachableError";
  }
}

const CATALOG_QUERY_KEYS: ReadonlySet<string> = new Set<keyof MarketplaceCatalogQuery>([
  "q",
  "type",
  "category",
  "author",
  "featured",
  "sort",
  "limit",
  "offset",
]);

const AUTHOR_QUERY_KEYS: ReadonlySet<string> = new Set<keyof MarketplaceAuthorQuery>(["limit", "offset"]);

/**
 * Checks a query's keys against `allowed` and each value's shape, so that a
 * caller can only ever send the marketplace the parameters it reads. An
 * unknown key is refused rather than dropped, for the reason the marketplace
 * refuses an unknown `type`: a misspelt filter silently ignored returns the
 * whole catalog and looks like working software.
 */
function queryObject(caller: string, query: unknown, allowed: ReadonlySet<string>): Record<string, unknown> {
  if (query === undefined || query === null) {
    return {};
  }
  if (typeof query !== "object" || Array.isArray(query)) {
    throw new Error(`${caller}: query must be an object`);
  }
  const unknown = Object.keys(query).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `${caller}: unknown query parameter ${unknown.map((key) => JSON.stringify(key)).join(", ")}; expected ${[...allowed].join(", ")}`
    );
  }
  return query as Record<string, unknown>;
}

function optionalString(caller: string, field: string, value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${caller}: ${field} must be a string`);
  }
  return value === "" ? undefined : value;
}

function optionalInteger(caller: string, field: string, value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${caller}: ${field} must be an integer`);
  }
  return value;
}

function setParam(params: URLSearchParams, key: string, value: string | number | undefined): void {
  if (value !== undefined) {
    params.set(key, String(value));
  }
}

/**
 * `GET /catalog`'s query string for `query`. Values are checked for shape
 * only; whether a `type`, `sort` or page size is acceptable is the
 * marketplace's call, and it refuses one that is not with 400.
 */
export function catalogSearchParams(caller: string, query: unknown): URLSearchParams {
  const raw = queryObject(caller, query, CATALOG_QUERY_KEYS);
  const params = new URLSearchParams();
  setParam(params, "q", optionalString(caller, "q", raw.q));
  if (raw.type !== undefined && raw.type !== null) {
    if (!Array.isArray(raw.type) || !raw.type.every((entry) => typeof entry === "string" && entry !== "")) {
      throw new Error(`${caller}: type must be an array of listing types`);
    }
    setParam(params, "type", raw.type.length > 0 ? raw.type.join(",") : undefined);
  }
  setParam(params, "category", optionalString(caller, "category", raw.category));
  setParam(params, "author", optionalString(caller, "author", raw.author));
  if (raw.featured !== undefined && raw.featured !== null) {
    if (typeof raw.featured !== "boolean") {
      throw new Error(`${caller}: featured must be a boolean`);
    }
    // The marketplace reads `featured` as a filter switch, so false is sent
    // as no parameter at all: that is what not filtering means.
    setParam(params, "featured", raw.featured ? "true" : undefined);
  }
  setParam(params, "sort", optionalString(caller, "sort", raw.sort));
  setParam(params, "limit", optionalInteger(caller, "limit", raw.limit));
  setParam(params, "offset", optionalInteger(caller, "offset", raw.offset));
  return params;
}

/** `GET /authors/{slug}`'s query string for `query`: a page, nothing else. */
export function authorSearchParams(caller: string, query: unknown): URLSearchParams {
  const raw = queryObject(caller, query, AUTHOR_QUERY_KEYS);
  const params = new URLSearchParams();
  setParam(params, "limit", optionalInteger(caller, "limit", raw.limit));
  setParam(params, "offset", optionalInteger(caller, "offset", raw.offset));
  return params;
}

function withQuery(path: string, params: URLSearchParams): string {
  const encoded = params.toString();
  return encoded === "" ? path : `${path}?${encoded}`;
}

export interface MarketplaceClientOptions {
  /** The marketplace API's origin, e.g. `https://marketplace.woofx3.tv`. */
  baseUrl: string;
  /**
   * Where archive downloads may be fetched from. An entry is a host, meaning
   * that host over HTTPS on the default port, or an origin with its scheme
   * (`http://127.0.0.1:9000`). Must not be empty.
   */
  downloadHosts: readonly string[];
  requestTimeoutMs?: number;
  downloadTimeoutMs?: number;
  maxArchiveBytes?: number;
}

/**
 * An allowlist entry as an origin. A bare host means HTTPS: a presigned
 * download carries its signature in the URL, so it must not cross the
 * network in clear text unless an operator spelled out `http://`.
 */
export function downloadOrigin(entry: string): string {
  const trimmed = entry.trim();
  if (trimmed === "") {
    throw new Error("A marketplace download host must not be empty");
  }
  const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Marketplace download host ${entry} must be http or https`);
  }
  if (url.pathname !== "/" || url.search !== "" || url.username !== "" || url.password !== "") {
    throw new Error(`Marketplace download host ${entry} must be a host or an origin, not a URL`);
  }
  return url.origin;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export class MarketplaceClient {
  readonly baseUrl: string;
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly requestTimeoutMs: number;
  private readonly downloadTimeoutMs: number;
  private readonly maxArchiveBytes: number;

  constructor(options: MarketplaceClientOptions) {
    const base = new URL(options.baseUrl);
    if (base.protocol !== "https:" && base.protocol !== "http:") {
      throw new Error(`Marketplace URL ${options.baseUrl} must be http or https`);
    }
    if (options.downloadHosts.length === 0) {
      throw new Error("A marketplace client needs at least one download host");
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.allowedOrigins = new Set(options.downloadHosts.map(downloadOrigin));
    this.requestTimeoutMs = options.requestTimeoutMs ?? MARKETPLACE_REQUEST_TIMEOUT_MS;
    this.downloadTimeoutMs = options.downloadTimeoutMs ?? MODULE_ARCHIVE_FETCH_TIMEOUT_MS;
    this.maxArchiveBytes = options.maxArchiveBytes ?? MODULE_ARCHIVE_MAX_BYTES;
  }

  // ---------- catalog reads, passed through unchanged ----------
  //
  // These return the marketplace's JSON exactly as it arrived. A caller that
  // already parses the marketplace's answers parses these the same way, so
  // moving its reads behind the engine changes where they come from and
  // nothing else.

  /** `GET /catalog`: one page of a search across every listing type. */
  async searchCatalog(params: URLSearchParams, buyerToken?: string): Promise<unknown> {
    return await this.request("GET", withQuery("/catalog", params), { bearer: buyerToken });
  }

  /** `GET /catalog/counts`: how many listings of each type there are. */
  async catalogCounts(buyerToken?: string): Promise<unknown> {
    return await this.request("GET", "/catalog/counts", { bearer: buyerToken });
  }

  /** `GET /catalog/{id}`: one listing with everything its page shows. */
  async catalogListing(listingId: string, buyerToken?: string): Promise<unknown> {
    return await this.request("GET", `/catalog/${encodeURIComponent(listingId)}`, { bearer: buyerToken });
  }

  /** `GET /authors/{slug}`: an author's profile and one page of their listings. */
  async author(slug: string, params: URLSearchParams, buyerToken?: string): Promise<unknown> {
    return await this.request("GET", withQuery(`/authors/${encodeURIComponent(slug)}`, params), {
      bearer: buyerToken,
    });
  }

  /**
   * `GET /catalog/{id}/quote`: what the token's buyer must do to hold the
   * listing. No `buyerRef` is sent: the token names the buyer, and the
   * marketplace refuses a `buyerRef` that names anyone else.
   */
  async quote(listingId: string, buyerToken: string): Promise<unknown> {
    return await this.request("GET", `/catalog/${encodeURIComponent(listingId)}/quote`, { bearer: buyerToken });
  }

  // ---------- install ----------

  /** One listing, read anonymously, with the fields an install needs. */
  async getListing(listingId: string): Promise<MarketplaceListing> {
    const payload = await this.request("GET", `/catalog/${encodeURIComponent(listingId)}`);
    const raw = asObject(asObject(payload).listing);
    const id = asString(raw.id);
    if (id === "" || !LISTING_TYPES.has(asString(raw.type))) {
      throw new Error(`Marketplace listing ${listingId} response was malformed`);
    }
    return {
      id,
      type: raw.type as MarketplaceListingType,
      name: asString(raw.name, id),
      description: asString(raw.description),
      version: asString(raw.version, "0.0.0"),
    };
  }

  /**
   * Claims the listing for the token's buyer, or confirms they hold it.
   * 402 means the buyer has to pay first; any other refusal (an unpriced,
   * unpublished or superseded listing) throws.
   */
  async acquire(listingId: string, buyerToken: string): Promise<MarketplaceAcquireResult> {
    try {
      const payload = await this.request("POST", `/catalog/${encodeURIComponent(listingId)}/acquire`, {
        bearer: buyerToken,
        body: {},
      });
      const obj = asObject(payload);
      if (obj.entitled !== true) {
        throw new Error(`Marketplace acquire for ${listingId} did not entitle the buyer`);
      }
      return { status: "entitled", source: asString(obj.source) };
    } catch (err) {
      if (err instanceof MarketplaceError && err.status === 402) {
        return { status: "payment_required" };
      }
      throw err;
    }
  }

  /**
   * A presigned download for a module's archive. Refused when the answer has
   * no SHA-256: an archive that cannot be checked is never installed.
   */
  async getModuleDownload(listingId: string, buyerToken?: string): Promise<MarketplaceDownload> {
    const payload = asObject(
      await this.request("GET", `/modules/${encodeURIComponent(listingId)}/download`, { bearer: buyerToken })
    );
    const url = asString(payload.url);
    if (url === "") {
      throw new Error(`Marketplace did not return a download URL for ${listingId}`);
    }
    const sha256 = asString(payload.sha256).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      throw new Error(`Marketplace did not return a valid sha256 hash for ${listingId}; refusing to install it`);
    }
    const download: MarketplaceDownload = { url, sha256 };
    if (payload.sizeBytes !== undefined && payload.sizeBytes !== null) {
      const sizeBytes = payload.sizeBytes;
      if (typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
        throw new Error(`Marketplace returned an invalid sizeBytes for ${listingId}`);
      }
      download.sizeBytes = sizeBytes;
    }
    return download;
  }

  /** An overlay or alert listing's bundle: the scene or alert-composition document. */
  async getBundle(listingId: string, buyerToken?: string): Promise<Record<string, unknown>> {
    const payload = await this.request("GET", `/catalog/${encodeURIComponent(listingId)}/bundle`, {
      bearer: buyerToken,
    });
    const bundle = asObject(payload).bundle;
    if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
      throw new Error(`Marketplace listing ${listingId} carries no bundle to install`);
    }
    return bundle as Record<string, unknown>;
  }

  /**
   * The archive `download` points at, checked against what the marketplace
   * recorded for it. Fetched only from an allowed origin, without following
   * redirects, and refused when its length or SHA-256 differs.
   */
  async fetchArchive(download: MarketplaceDownload): Promise<Uint8Array> {
    let origin: string;
    try {
      origin = new URL(download.url).origin;
    } catch {
      throw new Error("Marketplace download URL is not a URL");
    }
    if (!this.allowedOrigins.has(origin)) {
      throw new Error(`Marketplace download host ${origin} is not an allowed download host`);
    }
    if (download.sizeBytes !== undefined && download.sizeBytes > this.maxArchiveBytes) {
      throw new Error(`Marketplace archive exceeds size cap (${download.sizeBytes} > ${this.maxArchiveBytes})`);
    }
    const bytes = await fetchModuleArchive(download.url, {
      timeoutMs: this.downloadTimeoutMs,
      maxBytes: this.maxArchiveBytes,
      redirect: "error",
    });
    if (download.sizeBytes !== undefined && bytes.byteLength !== download.sizeBytes) {
      throw new Error(
        `Marketplace archive is ${bytes.byteLength} bytes, but the marketplace recorded ${download.sizeBytes}`
      );
    }
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== download.sha256) {
      throw new Error("Marketplace archive does not match the marketplace's sha256 hash");
    }
    return bytes;
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    options: { bearer?: string; body?: unknown } = {}
  ): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.bearer) {
      headers.Authorization = `Bearer ${options.bearer}`;
    }
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const timedOut = () =>
      new MarketplaceTimeoutError(`Marketplace ${method} ${path} timed out after ${this.requestTimeoutMs}ms`);
    try {
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
          redirect: "error",
        });
      } catch (err) {
        // A rejection before any response is a transport failure, whatever
        // the runtime names it: Node throws a TypeError, Bun its own errors.
        if (controller.signal.aborted) {
          throw timedOut();
        }
        const reason = err instanceof Error ? err.message : String(err);
        throw new MarketplaceUnreachableError(`Marketplace ${method} ${path} could not be reached: ${reason}`);
      }
      let text: string;
      try {
        text = await res.text();
      } catch (err) {
        if (controller.signal.aborted) {
          throw timedOut();
        }
        throw err;
      }
      if (!res.ok) {
        throw marketplaceError(method, path, res.status, text);
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new Error(`Marketplace ${method} ${path} answered with a body that is not JSON`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

/** A non-2xx answer as an error, reading the marketplace's JSON error envelope when there is one. */
function marketplaceError(method: string, path: string, status: number, body: string): MarketplaceError {
  let code = "";
  let detail = "";
  try {
    const envelope = asObject(asObject(JSON.parse(body)).error);
    code = asString(envelope.code);
    detail = asString(envelope.message);
  } catch {
    // Not the envelope; the status is all there is to report.
  }
  const reason = [code, detail].filter((part) => part !== "").join(": ");
  return new MarketplaceError(
    `Marketplace ${method} ${path} failed with ${status}${reason ? ` (${reason})` : ""}`,
    status,
    code,
    detail
  );
}
