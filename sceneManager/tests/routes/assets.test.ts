import { describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleStaticAssetRoute, versionedAssetUrl } from "../../src/routes/assets";

async function withPublicDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = join(tmpdir(), `scene-manager-assets-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(dir, "vendor"), { recursive: true });
  await writeFile(join(dir, "vendor", "lib.js"), "// lib");
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function get(path: string): { req: Request; url: URL } {
  const url = new URL(`http://scene.test${path}`);
  return { req: new Request(url, { method: "GET" }), url };
}

describe("handleStaticAssetRoute", () => {
  // Widgets live in the bundled woofx3 module and are served from
  // barkloader's repository, so this route does not special-case them
  // and nothing under a widgets/ path is staged for it to find.
  it("does not serve widget files", async () => {
    await withPublicDir(async (dir) => {
      const { req, url } = get("/assets/widgets/media_alert/lottie.min.js");
      const resp = await handleStaticAssetRoute(req, url, dir);
      expect(resp.status).toBe(404);
    });
  });

  it("maps every other path under publicDir verbatim", async () => {
    await withPublicDir(async (dir) => {
      const { req, url } = get("/assets/vendor/lib.js");
      const resp = await handleStaticAssetRoute(req, url, dir);
      expect(resp.status).toBe(200);
      expect(await resp.text()).toBe("// lib");
    });
  });

  it("caches a URL naming the current version for good, and answers any other uncached", async () => {
    await withPublicDir(async (dir) => {
      const current = await versionedAssetUrl("/assets/vendor/lib.js", dir);
      expect(current).toMatch(/^\/assets\/vendor\/lib\.js\?v=[\w-]{16}$/);

      const hit = get(current);
      const cached = await handleStaticAssetRoute(hit.req, hit.url, dir);
      expect(cached.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");

      const stale = get("/assets/vendor/lib.js?v=old");
      const uncached = await handleStaticAssetRoute(stale.req, stale.url, dir);
      expect(uncached.headers.get("Cache-Control")).toBe("no-cache");
      expect(await uncached.text()).toBe("// lib");
    });
  });

  it("lets a browser use an unversioned file while it revalidates", async () => {
    await withPublicDir(async (dir) => {
      const { req, url } = get("/assets/vendor/lib.js");
      const resp = await handleStaticAssetRoute(req, url, dir);
      expect(resp.headers.get("Cache-Control")).toBe("public, max-age=60, stale-while-revalidate=86400");
    });
  });

  it("answers a revalidation of an unchanged file with no body", async () => {
    await withPublicDir(async (dir) => {
      const first = get("/assets/vendor/lib.js");
      const etag = (await handleStaticAssetRoute(first.req, first.url, dir)).headers.get("ETag") as string;
      const req = new Request(first.url, { headers: { "If-None-Match": etag } });
      const resp = await handleStaticAssetRoute(req, first.url, dir);
      expect(resp.status).toBe(304);
      expect(await resp.text()).toBe("");
    });
  });

  it("gives a file that changed a new version", async () => {
    await withPublicDir(async (dir) => {
      const before = await versionedAssetUrl("/assets/vendor/lib.js", dir);
      await Bun.sleep(5);
      await writeFile(join(dir, "vendor", "lib.js"), "// lib, changed");
      expect(await versionedAssetUrl("/assets/vendor/lib.js", dir)).not.toBe(before);
    });
  });

  it("names a missing file without a version", async () => {
    await withPublicDir(async (dir) => {
      expect(await versionedAssetUrl("/assets/scene-manager/nope.js", dir)).toBe("/assets/scene-manager/nope.js");
    });
  });

  it("never escapes publicDir", async () => {
    // `new URL()` collapses a literal `..` before the handler sees it,
    // and a percent-encoded one stays literal in `pathname` — neither
    // reaches the filesystem as a parent-directory hop. The guarantee
    // under test is the outcome (never a 200 for content outside
    // publicDir), not which of the two refusal codes it lands on.
    await withPublicDir(async (dir) => {
      for (const path of [
        "/assets/vendor/../../../../etc/passwd",
        "/assets/vendor/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd",
      ]) {
        const { req, url } = get(path);
        const resp = await handleStaticAssetRoute(req, url, dir);
        expect(resp.status).not.toBe(200);
      }
    });
  });
});
