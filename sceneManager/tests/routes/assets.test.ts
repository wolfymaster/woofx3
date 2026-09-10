import { describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleStaticAssetRoute } from "../../src/routes/assets";

async function withPublicDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = join(tmpdir(), `scene-manager-assets-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(dir, "widgets", "builtin", "media_alert"), { recursive: true });
  await mkdir(join(dir, "vendor"), { recursive: true });
  await writeFile(join(dir, "widgets", "builtin", "media_alert", "lottie.min.js"), "// lottie");
  await writeFile(join(dir, "vendor", "datastar.js"), "// datastar");
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
  // Widgets moved to the bundled woofx3 module and are served from
  // barkloader's repository, so this route no longer special-cases them.
  it("does not serve widget files", async () => {
    await withPublicDir(async (dir) => {
      const { req, url } = get("/assets/builtin/widgets/media_alert/lottie.min.js");
      const resp = await handleStaticAssetRoute(req, url, dir);
      expect(resp.status).toBe(404);
    });
  });

  it("maps every other path under publicDir verbatim", async () => {
    await withPublicDir(async (dir) => {
      const { req, url } = get("/assets/vendor/datastar.js");
      const resp = await handleStaticAssetRoute(req, url, dir);
      expect(resp.status).toBe(200);
      expect(await resp.text()).toBe("// datastar");
    });
  });

  it("404s a builtin widget asset that does not exist", async () => {
    await withPublicDir(async (dir) => {
      const { req, url } = get("/assets/builtin/widgets/media_alert/missing.js");
      expect((await handleStaticAssetRoute(req, url, dir)).status).toBe(404);
    });
  });

  it("never escapes publicDir through the builtin prefix", async () => {
    // `new URL()` collapses a literal `..` before the handler sees it,
    // and a percent-encoded one stays literal in `pathname` — neither
    // reaches the filesystem as a parent-directory hop. The guarantee
    // under test is the outcome (never a 200 for content outside
    // publicDir), not which of the two refusal codes it lands on.
    await withPublicDir(async (dir) => {
      for (const path of [
        "/assets/builtin/widgets/../../../../etc/passwd",
        "/assets/builtin/widgets/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd",
      ]) {
        const { req, url } = get(path);
        const resp = await handleStaticAssetRoute(req, url, dir);
        expect(resp.status).not.toBe(200);
      }
    });
  });

  it("404s a non-GET request", async () => {
    await withPublicDir(async (dir) => {
      const url = new URL("http://scene.test/assets/vendor/datastar.js");
      const resp = await handleStaticAssetRoute(new Request(url, { method: "POST" }), url, dir);
      expect(resp.status).toBe(404);
    });
  });
});
