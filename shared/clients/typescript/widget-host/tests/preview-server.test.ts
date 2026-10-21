import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isWidgetBootPayload } from "@woofx3/module-sdk";
import { SHIM_SRC } from "../frame";
import { buildPreviewBundles, type PreviewBundles } from "../preview/bundles";
import { CHANGE_EVENT, CHANGES_PATH, MODULE_PATH, PAGE_SCRIPT_PATH, parseModuleAnswer } from "../preview/protocol";
import { PreviewServer } from "../preview/server";

const MANIFEST = {
  id: "mod",
  name: "Test Module",
  widgets: [
    {
      id: "plain",
      name: "Plain",
      entry: "widgets/plain/index.html",
      assets: "widgets/plain",
      settingsSchema: [{ id: "label", label: "Label", type: "text", defaultValue: "hi" }],
    },
    {
      id: "themed",
      name: "Themed",
      entry: "widgets/themed/index.html",
      assets: "widgets/themed",
      surfaces: ["alert"],
      settingsSchema: [{ id: "font", label: "Font", type: "font" }],
      theme: {
        contractVersion: 1,
        variables: [{ id: "accent", type: "color", default: "#7ad7ff" }],
        assetSlots: [{ id: "background", kinds: ["image"], default: "widgets/themed/bg.png" }],
      },
    },
    { id: "absent", name: "Absent", entry: "widgets/absent/index.html", assets: "widgets/absent" },
  ],
};

const FILES: Record<string, string> = {
  "widgets/plain/index.html": "<!doctype html><html><head><title>plain</title></head><body>plain</body></html>",
  "widgets/plain/data.json": '{"answer":42}',
  "widgets/themed/index.html": "<!doctype html><html><head></head><body>themed</body></html>",
  "widgets/themed/bg.png": "png",
};

let moduleDir: string;
let bundles: PreviewBundles;
let server: PreviewServer;
const warnings: string[] = [];

async function writeModuleFile(path: string, body: string): Promise<void> {
  await mkdir(dirname(join(moduleDir, path)), { recursive: true });
  await writeFile(join(moduleDir, path), body);
}

function get(path: string): Promise<Response> {
  return fetch(new URL(path, server.url));
}

/** The boot payload a frame document inlines. */
function inlinedBoot(html: string): unknown {
  const match = /window\.__WOOFX3_WIDGET_BOOT__ = (.*?);<\/script>/.exec(html);
  return match === null ? null : JSON.parse(match[1]!);
}

beforeAll(async () => {
  moduleDir = await mkdtemp(join(tmpdir(), "widget-preview-"));
  await writeModuleFile("manifest.json", JSON.stringify(MANIFEST));
  for (const [path, body] of Object.entries(FILES)) {
    await writeModuleFile(path, body);
  }
  bundles = await buildPreviewBundles();
  server = PreviewServer.start({
    moduleDir,
    hostname: "127.0.0.1",
    port: 0,
    bundles,
    log: { info: () => {}, warn: (message) => warnings.push(message) },
    changeSettleMs: 20,
  });
});

afterAll(async () => {
  await server.stop();
  await rm(moduleDir, { recursive: true, force: true });
});

describe("the bundles", () => {
  it("build the real shim as a classic script, and the page", () => {
    expect(bundles.shim).toContain("__WOOFX3_WIDGET_BOOT__");
    expect(bundles.shim).toContain("woofx3.widget");
    expect(bundles.shim).not.toMatch(/^\s*(import|export)\s/m);
    expect(bundles.html).toContain(`src="${PAGE_SCRIPT_PATH}"`);
    expect(bundles.page.length).toBeGreaterThan(0);
  });
});

describe("the preview server", () => {
  it("serves the page, its script and the shim", async () => {
    for (const [path, body, type] of [
      ["/", bundles.html, "text/html"],
      [PAGE_SCRIPT_PATH, bundles.page, "text/javascript"],
      [SHIM_SRC, bundles.shim, "text/javascript"],
    ] as const) {
      const response = await get(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain(type);
      expect(await response.text()).toBe(body);
    }
  });

  it("describes the module's widgets that have an entry", async () => {
    const answer = parseModuleAnswer(await (await get(MODULE_PATH)).json());
    expect(answer).toEqual({
      module: {
        id: "mod",
        name: "Test Module",
        widgets: [
          {
            id: "plain",
            name: "Plain",
            canonicalId: "mod:widget:plain",
            surfaces: ["scene"],
            settingsSchema: [{ id: "label", label: "Label", type: "text", defaultValue: "hi" }],
          },
          {
            id: "themed",
            name: "Themed",
            canonicalId: "mod:widget:themed",
            surfaces: ["alert"],
            settingsSchema: [{ id: "font", label: "Font", type: "font" }],
          },
          { id: "absent", name: "Absent", canonicalId: "mod:widget:absent", surfaces: ["scene"], settingsSchema: [] },
        ],
      },
    });
  });

  it("builds a widget's frame document as the scene manager does, under the frame policy", async () => {
    const response = await get("/frames/plain");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toBe("connect-src 'none'; sandbox allow-scripts");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const html = await response.text();
    const resourceBaseUrl = `${server.url}assets/modules/mod/preview/widgets/plain/`;
    expect(html).toContain(`<script src="${SHIM_SRC}"></script><base href="${resourceBaseUrl}">`);
    expect(html).toContain("<title>plain</title>");
    // The placement's half is the page's to add, in the fragment.
    const boot = inlinedBoot(html);
    expect(boot).toEqual({
      v: 1,
      moduleId: "mod",
      widgetCanonicalId: "mod:widget:plain",
      surface: "scene",
      capabilities: ["storage", "events", "status", "settings", "assets"],
      resourceBaseUrl,
      theme: null,
    });
    expect(isWidgetBootPayload({ ...(boot as object), nonce: "n", instanceId: "i", settings: {} })).toBe(true);
  });

  it("frames a themeable widget with its contract defaults, its fonts, and the theme policy", async () => {
    const response = await get("/frames/themed");
    const origin = new URL(server.url).origin;
    expect(response.headers.get("Content-Security-Policy")).toContain(`style-src 'self' ${origin} 'unsafe-inline'`);
    expect(response.headers.get("Content-Security-Policy")).toContain("connect-src 'none'; sandbox allow-scripts");
    const html = await response.text();
    const resourceBaseUrl = `${server.url}assets/modules/mod/preview/widgets/themed/`;
    expect(html).toContain("--theme-accent: #7ad7ff;");
    expect(html).toContain(`--theme-asset-background: url("${resourceBaseUrl}bg.png");`);
    expect(inlinedBoot(html)).toMatchObject({
      theme: {
        id: null,
        contractVersion: 1,
        variables: { accent: "#7ad7ff" },
        assets: { background: `${resourceBaseUrl}bg.png` },
        defaultAssets: { background: `${resourceBaseUrl}bg.png` },
        fallback: null,
      },
      fonts: { settings: ["font"], stylesheetUrl: "/fonts/css" },
    });
  });

  it("says in the frame what is wrong when a widget cannot be framed", async () => {
    const unknown = await get("/frames/nope");
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toContain("mod has no widget nope with an entry");
    const absent = await get("/frames/absent");
    expect(absent.status).toBe(404);
    expect(await absent.text()).toContain("its entry widgets/absent/index.html does not exist");
    expect(absent.headers.get("Content-Security-Policy")).toBe("connect-src 'none'; sandbox allow-scripts");
  });

  it("serves a widget's files under its engine path and through the read route", async () => {
    for (const path of [
      "/assets/modules/mod/preview/widgets/plain/data.json",
      "/assets/read/modules/mod/preview/widgets/plain/data.json",
    ]) {
      const response = await get(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("application/json");
      expect(await response.json()).toEqual({ answer: 42 });
    }
  });

  it.each([
    "/assets/modules/mod/preview/widgets/plain/..%2F..%2F..%2Fmanifest.json",
    "/assets/modules/mod/preview/widgets/plain/..%5C..%5Cmanifest.json",
    "/assets/modules/other/preview/widgets/plain/data.json",
    "/assets/modules/mod/1.0.0/widgets/plain/data.json",
    "/assets/modules/mod/preview/themes/plain/data.json",
    "/assets/modules/mod/preview/widgets/nope/data.json",
    "/assets/modules/mod/preview/widgets/plain/missing.json",
    "/assets/read/user/lib1/photo.png",
    "/assets/elsewhere/x",
  ])("finds nothing at %s", async (path) => {
    expect((await get(path)).status).toBe(404);
  });

  it("tells the author once that the preview has no asset library", async () => {
    await get("/assets/user/lib1/a.png");
    await get("/assets/user/lib1/b.png");
    expect(warnings.filter((warning) => warning.includes("asset library"))).toHaveLength(1);
  });

  it("explains a manifest it cannot read, to the page and in the frame", async () => {
    await writeModuleFile("manifest.json", "{ not json");
    try {
      const answer = await get(MODULE_PATH);
      expect(answer.status).toBe(422);
      expect(parseModuleAnswer(await answer.json())).toEqual({
        error: { code: "manifest_invalid", message: expect.stringContaining("manifest.json is not valid JSON") },
      });
      const frame = await get("/frames/plain");
      expect(frame.status).toBe(500);
      expect(await frame.text()).toContain("manifest.json is not valid JSON");
    } finally {
      await writeModuleFile("manifest.json", JSON.stringify(MANIFEST));
    }
  });

  it("tells the page when a file in the module changes", async () => {
    const response = await get(CHANGES_PATH);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = decoder.decode((await reader.read()).value);
    expect(received).toContain(": watching");
    await writeModuleFile("widgets/plain/index.html", FILES["widgets/plain/index.html"]!.replace("plain", "edited"));
    while (!received.includes(`event: ${CHANGE_EVENT}`)) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      received += decoder.decode(chunk.value);
    }
    expect(received).toContain(`event: ${CHANGE_EVENT}\ndata: {}\n\n`);
    await reader.cancel();
  });
});
