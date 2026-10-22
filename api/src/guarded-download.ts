import { createHash } from "node:crypto";

/**
 * Downloads module archives from URLs a caller handed the engine, refusing
 * anything that could turn the engine into a proxy for its own network: a
 * scheme other than http(s) (Bun's fetch reads `file:` URLs), an origin
 * outside the allow-list, a redirect (it would lead to a host nobody
 * checked), and a body larger than the cap, counted as it streams in rather
 * than after it has been buffered.
 *
 * Every archive download the engine makes goes through one of these, so the
 * marketplace install and the install from a URL refuse the same things.
 */

export interface GuardedDownloadConfig {
  /** How long a download may take, from the request to the last body byte. */
  timeoutMs: number;
  /**
   * The largest body accepted. Archives carry code, a manifest and a few
   * assets; the cap keeps a malformed or hostile source from making the
   * engine hold an unbounded download in memory.
   */
  maxBytes: number;
}

export const DEFAULT_GUARDED_DOWNLOAD_CONFIG: Readonly<GuardedDownloadConfig> = {
  timeoutMs: 30_000,
  maxBytes: 50 * 1024 * 1024,
};

/** The one fetch call the downloader makes; injected so tests can watch it. */
export type DownloadFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface GuardedDownloaderOptions {
  fetch: DownloadFetch;
  /** Allow-list entries in the form `downloadOrigin` accepts. Must not be empty. */
  downloadHosts: readonly string[];
  config: GuardedDownloadConfig;
}

/** What the caller already knows about the archive; each field given is checked. */
export interface DownloadExpectation {
  /** Lowercase hex SHA-256 of the archive. */
  sha256?: string;
  /** The archive's exact length in bytes. */
  sizeBytes?: number;
}

export type DownloadErrorKind =
  | "invalid_url"
  | "disallowed_origin"
  | "redirect"
  | "http_status"
  | "too_large"
  | "size_mismatch"
  | "sha256_mismatch"
  | "timeout"
  | "network";

export interface DownloadError {
  kind: DownloadErrorKind;
  message: string;
}

export type DownloadResult = { ok: true; value: Uint8Array } | { ok: false; error: DownloadError };

const SHA256_HEX = /^[0-9a-f]{64}$/;

function downloaded(value: Uint8Array): DownloadResult {
  return { ok: true, value };
}

function refused(kind: DownloadErrorKind, message: string): DownloadResult {
  return { ok: false, error: { kind, message } };
}

/** Whether `hostname`, as `URL.hostname` spells it, can only reach this machine. */
function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "[::1]" || /^127(\.\d{1,3}){3}$/.test(hostname);
}

/** Whether `value` is a lowercase hex SHA-256, the only spelling a download expectation accepts. */
export function isSha256Hex(value: string): boolean {
  return SHA256_HEX.test(value);
}

/**
 * An allow-list entry as an origin. A bare host means HTTPS: a presigned
 * download carries its signature in the URL, so it must not cross the
 * network in clear text. An `http://` entry is accepted only for a loopback
 * host, which is where a local marketplace serves its archives.
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
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    throw new Error(`Marketplace download host ${entry} may use http only on a loopback host`);
  }
  if (url.pathname !== "/" || url.search !== "" || url.username !== "" || url.password !== "") {
    throw new Error(`Marketplace download host ${entry} must be a host or an origin, not a URL`);
  }
  return url.origin;
}

export class GuardedDownloader {
  private readonly fetch: DownloadFetch;
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly config: GuardedDownloadConfig;

  constructor(options: GuardedDownloaderOptions) {
    if (options.downloadHosts.length === 0) {
      throw new Error("A guarded downloader needs at least one download host");
    }
    if (!Number.isSafeInteger(options.config.maxBytes) || options.config.maxBytes <= 0) {
      throw new Error(`Download maxBytes must be a positive integer, got ${options.config.maxBytes}`);
    }
    if (!Number.isSafeInteger(options.config.timeoutMs) || options.config.timeoutMs <= 0) {
      throw new Error(`Download timeoutMs must be a positive integer, got ${options.config.timeoutMs}`);
    }
    this.fetch = options.fetch;
    this.allowedOrigins = new Set(options.downloadHosts.map(downloadOrigin));
    this.config = { ...options.config };
  }

  /**
   * The body at `url`, read in full, or why it was refused. Nothing is
   * fetched unless the URL's origin is on the allow-list. Every refusal is
   * returned as a result, except a malformed expected sha256: that is a
   * caller bug and throws.
   */
  async download(url: string, expect: DownloadExpectation = {}): Promise<DownloadResult> {
    if (expect.sha256 !== undefined && !isSha256Hex(expect.sha256)) {
      throw new Error("An expected sha256 must be 64 lowercase hex characters");
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return refused("invalid_url", "Archive download URL is not a URL");
    }
    // `URL.origin` is "null" for every non-http(s) scheme, so file:, data:
    // and the rest can never match an allow-list entry; checking the scheme
    // first gives them a clearer refusal.
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return refused("disallowed_origin", `Archive download scheme ${parsed.protocol} is not allowed`);
    }
    if (!this.allowedOrigins.has(parsed.origin)) {
      return refused("disallowed_origin", `Archive download host ${parsed.origin} is not an allowed download host`);
    }
    const { maxBytes, timeoutMs } = this.config;
    if (expect.sizeBytes !== undefined && expect.sizeBytes > maxBytes) {
      return refused("too_large", `Archive exceeds size cap (${expect.sizeBytes} > ${maxBytes})`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const body = await this.readCapped(parsed.href, controller.signal);
      if (!body.ok) {
        return body;
      }
      return verify(body.value, expect);
    } catch (err) {
      if (controller.signal.aborted) {
        return refused("timeout", `Archive download timed out after ${timeoutMs}ms`);
      }
      if (isRedirectRefusal(err)) {
        return refused("redirect", "Redirect refused: archive downloads never follow redirects");
      }
      const reason = err instanceof Error ? err.message : String(err);
      return refused("network", `Archive download failed: ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async readCapped(url: string, signal: AbortSignal): Promise<DownloadResult> {
    const { maxBytes } = this.config;
    const res = await this.fetch(url, { signal, redirect: "error" });
    if (!res.ok) {
      await res.body?.cancel();
      return refused("http_status", `Archive download failed: ${res.status} ${res.statusText}`);
    }
    const declared = res.headers.get("content-length");
    if (declared !== null && Number(declared) > maxBytes) {
      await res.body?.cancel();
      return refused("too_large", `Archive exceeds size cap (${declared} > ${maxBytes})`);
    }
    if (!res.body) {
      return downloaded(new Uint8Array(0));
    }
    // The declared length is a hint from the sender, so the cap is enforced
    // on the bytes as they arrive: a body that lies about its length, or
    // sends none, is cut off once it passes the cap.
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        return refused("too_large", `Archive exceeds size cap (more than ${maxBytes} bytes)`);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return downloaded(bytes);
  }
}

function verify(bytes: Uint8Array, expect: DownloadExpectation): DownloadResult {
  if (expect.sizeBytes !== undefined && bytes.byteLength !== expect.sizeBytes) {
    return refused("size_mismatch", `Archive is ${bytes.byteLength} bytes, but ${expect.sizeBytes} were expected`);
  }
  if (expect.sha256 !== undefined) {
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expect.sha256) {
      return refused("sha256_mismatch", "Archive does not match its expected sha256 hash");
    }
  }
  return downloaded(bytes);
}

/**
 * Whether a fetch rejection is `redirect: "error"` refusing a redirect. Bun,
 * the only runtime this service targets, names it with code
 * `UnexpectedRedirect`.
 */
function isRedirectRefusal(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  const code = (err as { code?: unknown }).code;
  return code === "UnexpectedRedirect";
}
