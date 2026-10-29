import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  DEFAULT_GUARDED_DOWNLOAD_CONFIG,
  type DownloadErrorKind,
  type DownloadFetch,
  type DownloadResult,
  downloadOrigin,
  GuardedDownloader,
} from "../src/guarded-download";

const ARCHIVE = new TextEncoder().encode("PK a small module archive");
const CHUNK = new Uint8Array(256).fill(7);
const UNSIZED_CHUNKS = 400;
let unsizedChunksSent = 0;

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req): Response {
    const path = new URL(req.url).pathname;
    if (path === "/archive") {
      return new Response(ARCHIVE);
    }
    if (path === "/redirect") {
      return Response.redirect(`http://127.0.0.1:${server.port}/archive`, 302);
    }
    if (path === "/unsized") {
      // No content-length, and far more than the cap allows; sent one chunk at
      // a time so a reader that stops early leaves most of it unsent.
      let sent = 0;
      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            if (sent === UNSIZED_CHUNKS) {
              controller.close();
              return;
            }
            await Bun.sleep(1);
            sent += 1;
            unsizedChunksSent = sent;
            controller.enqueue(CHUNK);
          },
        })
      );
    }
    if (path === "/slow") {
      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            await Bun.sleep(1_000);
            controller.enqueue(CHUNK);
          },
        })
      );
    }
    return new Response("missing", { status: 404, statusText: "Not Found" });
  },
});

afterAll(() => {
  server.stop(true);
});

const ORIGIN = `http://127.0.0.1:${server.port}`;

function downloader(overrides: { maxBytes?: number; timeoutMs?: number; fetch?: DownloadFetch } = {}) {
  return new GuardedDownloader({
    fetch: overrides.fetch ?? ((url, init) => fetch(url, init)),
    downloadHosts: [ORIGIN],
    config: {
      maxBytes: overrides.maxBytes ?? DEFAULT_GUARDED_DOWNLOAD_CONFIG.maxBytes,
      timeoutMs: overrides.timeoutMs ?? DEFAULT_GUARDED_DOWNLOAD_CONFIG.timeoutMs,
    },
  });
}

/** A fetch that records each URL it is asked for and then fails the test if it is ever used. */
function forbiddenFetch(calls: string[]): DownloadFetch {
  return async (url) => {
    calls.push(url);
    throw new Error(`unexpected fetch of ${url}`);
  };
}

function expectRefused(result: DownloadResult, kind: DownloadErrorKind): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.kind).toBe(kind);
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("GuardedDownloader.download", () => {
  test("downloads an archive from an allowed origin and checks its sha256 and size", async () => {
    const result = await downloader().download(`${ORIGIN}/archive`, {
      sha256: sha256(ARCHIVE),
      sizeBytes: ARCHIVE.byteLength,
    });

    expect(result).toEqual({ ok: true, value: ARCHIVE });
  });

  test.each([
    ["file:///etc/hostname"],
    ["data:application/zip;base64,UEs="],
    ["ftp://127.0.0.1/archive.zip"],
  ])("refuses %s without fetching it", async (url) => {
    const calls: string[] = [];

    const result = await downloader({ fetch: forbiddenFetch(calls) }).download(url);

    expectRefused(result, "disallowed_origin");
    expect(calls).toEqual([]);
  });

  test.each([
    ["http://127.0.0.1:5555/v1/modules"],
    [`https://127.0.0.1:${server.port}/archive`],
    ["https://evil.example/archive.zip"],
  ])("refuses %s, an origin that is not allow-listed, without fetching it", async (url) => {
    const calls: string[] = [];

    const result = await downloader({ fetch: forbiddenFetch(calls) }).download(url);

    expectRefused(result, "disallowed_origin");
    expect(calls).toEqual([]);
  });

  test("refuses a string that is not a URL", async () => {
    expectRefused(await downloader().download("not a url"), "invalid_url");
  });

  test("refuses a redirect, even to an allowed origin", async () => {
    const result = await downloader().download(`${ORIGIN}/redirect`);

    expectRefused(result, "redirect");
  });

  test("cuts off a body with no content-length once it passes the cap", async () => {
    const result = await downloader({ maxBytes: 4 * CHUNK.byteLength }).download(`${ORIGIN}/unsized`);

    expectRefused(result, "too_large");
    expect(unsizedChunksSent).toBeLessThan(UNSIZED_CHUNKS);
  });

  test("cancels the body stream when it passes the cap", async () => {
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(CHUNK);
      },
      cancel() {
        cancelled = true;
      },
    });

    const result = await downloader({
      maxBytes: 4 * CHUNK.byteLength,
      fetch: async () => new Response(endless),
    }).download(`${ORIGIN}/anything`);

    expectRefused(result, "too_large");
    expect(cancelled).toBe(true);
  });

  test("refuses a declared content-length over the cap and cancels the body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(CHUNK);
      },
      cancel() {
        cancelled = true;
      },
    });
    // Bun.serve rewrites content-length to the real body length, so the lying
    // header is answered in process.
    const declared = async () => new Response(body, { headers: { "content-length": String(10 * 1024 * 1024) } });

    const result = await downloader({ maxBytes: 1024, fetch: declared }).download(`${ORIGIN}/archive`);

    expectRefused(result, "too_large");
    expect(cancelled).toBe(true);
  });

  test("refuses an expected size over the cap without fetching it", async () => {
    const calls: string[] = [];

    const result = await downloader({ maxBytes: 1024, fetch: forbiddenFetch(calls) }).download(`${ORIGIN}/archive`, {
      sizeBytes: 2048,
    });

    expectRefused(result, "too_large");
    expect(calls).toEqual([]);
  });

  test("refuses an archive whose sha256 differs", async () => {
    const result = await downloader().download(`${ORIGIN}/archive`, { sha256: sha256(new Uint8Array([1, 2, 3])) });

    expectRefused(result, "sha256_mismatch");
  });

  test("refuses an archive whose length differs from the expected size", async () => {
    const result = await downloader().download(`${ORIGIN}/archive`, { sizeBytes: ARCHIVE.byteLength + 1 });

    expectRefused(result, "size_mismatch");
  });

  test("refuses a non-2xx answer", async () => {
    const result = await downloader().download(`${ORIGIN}/nothing-here`);

    expectRefused(result, "http_status");
    if (!result.ok) {
      expect(result.error.message).toContain("404");
    }
  });

  test("gives up on a body that takes longer than the timeout", async () => {
    const result = await downloader({ timeoutMs: 50 }).download(`${ORIGIN}/slow`);

    expectRefused(result, "timeout");
  });

  test("throws on a malformed expected sha256: that is the caller's bug, not the download's", async () => {
    await expect(downloader().download(`${ORIGIN}/archive`, { sha256: "ABC" })).rejects.toThrow("64 lowercase hex");
  });
});

describe("GuardedDownloader construction", () => {
  test.each([
    ["no download hosts", { downloadHosts: [], config: DEFAULT_GUARDED_DOWNLOAD_CONFIG }, "at least one download host"],
    ["a zero cap", { downloadHosts: [ORIGIN], config: { maxBytes: 0, timeoutMs: 1_000 } }, "maxBytes"],
    ["a fractional timeout", { downloadHosts: [ORIGIN], config: { maxBytes: 1, timeoutMs: 0.5 } }, "timeoutMs"],
  ])("refuses %s", (_name, options, message) => {
    expect(() => new GuardedDownloader({ fetch: (url, init) => fetch(url, init), ...options })).toThrow(message);
  });
});

describe("downloadOrigin", () => {
  test.each([
    ["a.example", "https://a.example"],
    [" https://a.example:8443 ", "https://a.example:8443"],
    ["http://127.0.0.1:9000", "http://127.0.0.1:9000"],
    ["http://localhost:9000", "http://localhost:9000"],
    ["http://[::1]:9000", "http://[::1]:9000"],
  ])("reads %s as %s", (entry, origin) => {
    expect(downloadOrigin(entry)).toBe(origin);
  });

  test.each([
    ["", "must not be empty"],
    ["ftp://a.example", "must be http or https"],
    ["http://a.example", "http only on a loopback host"],
    ["http://10.0.0.5:9000", "http only on a loopback host"],
    ["https://a.example/path", "not a URL"],
  ])("refuses %s", (entry, message) => {
    expect(() => downloadOrigin(entry)).toThrow(message);
  });
});
