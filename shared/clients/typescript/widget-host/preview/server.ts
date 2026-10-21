// The preview server: hosts one module's widgets from its folder the way the
// engine hosts them installed. Each frame document is built by
// `frameDocument`, as the scene manager builds it, booting the real shim; the
// widget's files are served under the engine path its resource base names;
// and the page around the frame is the preview page, which answers the frame
// with the same bridge, event queue and asset cache an overlay uses.
//
// The manifest is read on every request rather than once, so an edit to it
// shows on the next reload with nothing to restart.

import { type FSWatcher, watch } from "node:fs";
import { assetOfReadPath, PROTOCOL_VERSION, parseEngineAssetPath, WIDGET_CAPABILITIES } from "@woofx3/module-sdk";
import {
  contentSecurityPolicy,
  FRAME_DIRECTIVES,
  FRAME_DOCUMENT_HEADERS,
  frameDocument,
  hostTheme,
  SHIM_SRC,
  type WidgetFrameBoot,
} from "../frame";
import { escapeHtmlAttribute } from "../frame/html";
import type { PreviewBundles } from "./bundles";
import { FontRelay } from "./fonts";
import {
  contractDefaultTheme,
  PREVIEW_VERSION_DIR,
  type PreviewModule,
  type PreviewWidget,
  readPreviewModule,
  widgetFilePath,
} from "./module";
import {
  CHANGE_EVENT,
  CHANGES_PATH,
  FONT_FILES_PREFIX,
  FONT_STYLESHEET_PATH,
  MODULE_PATH,
  type ModuleAnswer,
  type ModuleView,
  PAGE_SCRIPT_PATH,
} from "./protocol";

/** How long file changes are gathered into one before the page is told: an editor's save is often several writes. */
export const CHANGE_SETTLE_MS = 100;

/** Folders under a module whose changes are no edit to it. */
const UNWATCHED_DIRS = new Set(["node_modules", ".git"]);

/** Every preview response is current: the files behind it can change at any moment. */
const NO_STORE = { "Cache-Control": "no-store" };

export interface PreviewLog {
  info(message: string): void;
  /** Something the author should know about: a file a widget asked for that is missing, say. */
  warn(message: string): void;
}

export interface PreviewServerOptions {
  /** The module's folder: where its `manifest.json` is. */
  moduleDir: string;
  hostname: string;
  /** `0` for any free port. */
  port: number;
  bundles: PreviewBundles;
  log: PreviewLog;
  fonts?: FontRelay;
  /** `CHANGE_SETTLE_MS` by default. */
  changeSettleMs?: number;
}

/** The engine path a widget's files are served under, as barkloader names an installed widget's. */
export function widgetResourceBaseUrl(origin: string, moduleId: string, widgetId: string): string {
  return `${origin}/assets/modules/${encodeURIComponent(moduleId)}/${PREVIEW_VERSION_DIR}/widgets/${encodeURIComponent(widgetId)}/`;
}

function viewOf(module: PreviewModule): ModuleView {
  return {
    id: module.id,
    name: module.name,
    widgets: module.widgets.map((widget) => ({
      id: widget.id,
      name: widget.name,
      canonicalId: widget.canonicalId,
      surfaces: widget.surfaces,
      settingsSchema: widget.settingsSchema,
    })),
  };
}

function json(body: ModuleAnswer, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function notFound(): Response {
  return new Response("Not Found", { status: 404, headers: NO_STORE });
}

/** A frame document that says what is wrong, where the widget would have been. */
function frameProblem(status: number, message: string): Response {
  return new Response(
    `<!doctype html><html><body style="font:14px system-ui;color:#f88;background:#200;margin:0;padding:12px">` +
      `<pre style="white-space:pre-wrap">${escapeHtmlAttribute(message)}</pre></body></html>`,
    {
      status,
      headers: {
        ...FRAME_DOCUMENT_HEADERS,
        "Content-Security-Policy": contentSecurityPolicy(FRAME_DIRECTIVES),
        ...NO_STORE,
      },
    }
  );
}

export class PreviewServer {
  private readonly server: ReturnType<typeof Bun.serve>;
  private readonly watcher: FSWatcher;
  private readonly fonts: FontRelay;
  private readonly changeStreams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private warnedLibrary = false;

  private constructor(private readonly options: PreviewServerOptions) {
    this.fonts = options.fonts ?? new FontRelay();
    const bundles = options.bundles;
    const script = (body: string) => () =>
      new Response(body, { headers: { "Content-Type": "text/javascript; charset=utf-8", ...NO_STORE } });
    this.server = Bun.serve({
      hostname: options.hostname,
      port: options.port,
      // The change stream stays open for as long as the page does.
      idleTimeout: 0,
      routes: {
        "/": {
          GET: () =>
            new Response(bundles.html, { headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE } }),
        },
        [PAGE_SCRIPT_PATH]: { GET: script(bundles.page) },
        [SHIM_SRC]: { GET: script(bundles.shim) },
        [MODULE_PATH]: { GET: () => this.moduleAnswer() },
        [CHANGES_PATH]: { GET: () => this.changeStream() },
        "/frames/:widgetId": { GET: (req) => this.frame(req, req.params.widgetId) },
        "/assets/*": { GET: (req) => this.asset(new URL(req.url).pathname) },
        [FONT_STYLESHEET_PATH]: { GET: (req) => this.fonts.stylesheet(new URL(req.url).searchParams.get("family")) },
        [`${FONT_FILES_PREFIX}*`]: {
          GET: (req) => this.fonts.file(new URL(req.url).pathname.slice(FONT_FILES_PREFIX.length)),
        },
      },
      fetch: () => notFound(),
    });
    this.watcher = watch(options.moduleDir, { recursive: true }, (_event, filename) => this.fileChanged(filename));
  }

  /** Serve `options.moduleDir` until `stop`. */
  static start(options: PreviewServerOptions): PreviewServer {
    return new PreviewServer(options);
  }

  get url(): string {
    return this.server.url.href;
  }

  async stop(): Promise<void> {
    this.watcher.close();
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    for (const stream of this.changeStreams) {
      stream.close();
    }
    this.changeStreams.clear();
    await this.server.stop(true);
  }

  private async moduleAnswer(): Promise<Response> {
    const read = await readPreviewModule(this.options.moduleDir);
    if (!read.ok) {
      return json({ error: { code: "manifest_invalid", message: read.error } }, 422);
    }
    return json({ module: viewOf(read.module) }, 200);
  }

  private async frame(req: Request, widgetId: string): Promise<Response> {
    const read = await readPreviewModule(this.options.moduleDir);
    if (!read.ok) {
      return frameProblem(500, read.error);
    }
    const module = read.module;
    const widget = module.widgets.find((candidate) => candidate.id === widgetId);
    if (widget === undefined) {
      return frameProblem(404, `${module.id} has no widget ${widgetId} with an entry`);
    }
    const entry = this.widgetFile(widget, widget.entry);
    if (entry === null || !(await entry.exists())) {
      return frameProblem(404, `widget ${widget.id}: its entry ${widget.assetsDir}/${widget.entry} does not exist`);
    }
    const resourceBaseUrl = widgetResourceBaseUrl(new URL(req.url).origin, module.id, widget.id);
    const theme = contractDefaultTheme(widget, resourceBaseUrl);
    const boot: WidgetFrameBoot = {
      v: PROTOCOL_VERSION,
      moduleId: module.id,
      widgetCanonicalId: widget.canonicalId,
      surface: "scene",
      capabilities: [...WIDGET_CAPABILITIES],
      resourceBaseUrl,
      theme: theme === null ? null : hostTheme(theme),
      ...(widget.fontSettings.length === 0
        ? {}
        : { fonts: { settings: [...widget.fontSettings], stylesheetUrl: FONT_STYLESHEET_PATH } }),
    };
    const document = frameDocument({ entryHtml: await entry.text(), resourceBaseUrl, theme }, boot);
    return new Response(document.html, { headers: { ...document.headers, ...NO_STORE } });
  }

  /**
   * A file of one of the module's widgets, by the engine path it is served
   * under (`/assets/modules/...`) or the read route a page reads it through
   * (`/assets/read/modules/...`). The module has no asset library behind it,
   * so a library path (`/assets/user/...`) finds nothing.
   */
  private async asset(pathname: string): Promise<Response> {
    const asset = assetOfReadPath(pathname) ?? parseEngineAssetPath(pathname);
    if (asset === null) {
      return notFound();
    }
    if (asset.area === "user") {
      if (!this.warnedLibrary) {
        this.warnedLibrary = true;
        this.options.log.warn(
          `a widget asked for ${pathname}, a file in the asset library; the preview has none, so library files are not found`
        );
      }
      return notFound();
    }
    // `/assets/modules/{moduleId}/{version}/widgets/{widgetId}/{file...}`,
    // every segment already checked by `parseEngineAssetPath`.
    const [, , owner, version, area, widgetId, ...rest] = asset.path.split("/").slice(1).map(decodeURIComponent);
    const read = await readPreviewModule(this.options.moduleDir);
    const widget = read.ok ? read.module.widgets.find((candidate) => candidate.id === widgetId) : undefined;
    const file =
      read.ok &&
      owner === read.module.id &&
      version === PREVIEW_VERSION_DIR &&
      area === "widgets" &&
      widget !== undefined &&
      rest.length > 0
        ? this.widgetFile(widget, rest.join("/"))
        : null;
    if (file === null || !(await file.exists())) {
      this.options.log.warn(`not found: ${pathname}`);
      return notFound();
    }
    return new Response(file, { headers: NO_STORE });
  }

  private widgetFile(widget: PreviewWidget, rel: string): ReturnType<typeof Bun.file> | null {
    const path = widgetFilePath(this.options.moduleDir, widget, rel);
    return path === null ? null : Bun.file(path);
  }

  private changeStream(): Response {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start: (opened) => {
        controller = opened;
        this.changeStreams.add(opened);
        // A comment, so the page sees the stream open before the first change.
        opened.enqueue(new TextEncoder().encode(": watching\n\n"));
      },
      cancel: () => {
        if (controller !== null) {
          this.changeStreams.delete(controller);
        }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", ...NO_STORE } });
  }

  private fileChanged(filename: string | null): void {
    const segments = (filename ?? "").split(/[\\/]/);
    if (segments.some((segment) => UNWATCHED_DIRS.has(segment))) {
      return;
    }
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
    }
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.options.log.info(`changed: ${filename ?? "the module"}`);
      const message = new TextEncoder().encode(`event: ${CHANGE_EVENT}\ndata: {}\n\n`);
      for (const stream of this.changeStreams) {
        stream.enqueue(message);
      }
    }, this.options.changeSettleMs ?? CHANGE_SETTLE_MS);
  }
}
