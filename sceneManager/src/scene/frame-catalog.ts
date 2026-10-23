import { createHash } from "node:crypto";
import type { Logger } from "@woofx3/common/runtime";
import { type CompositionDocument, type NodeId, parseWidgetCanonicalId } from "@woofx3/scene/model";
import type { AlertWidgetFrame } from "../../contract/alert-delivery";
import { selectedThemeId } from "../../contract/scene-config";
import type { BarkloaderFrameClient, BarkloaderFrameInfo } from "./frame-assembler";
import { frameMediaProxyBase } from "./media-proxy";
import type { OverlayWidgetInstance } from "./scene-host";

/**
 * Bumped whenever the frame assembler changes what it writes into a frame
 * document, so cached documents built the old way are not reused.
 */
export const FRAME_DOCUMENT_REVISION = 2;

/**
 * The version of the frame document barkloader's answer produces. It changes
 * exactly when the document would: a module upgrade moves the resource base
 * and the entry, a theme change moves the theme, and a change to how frames
 * are assembled bumps `FRAME_DOCUMENT_REVISION`.
 */
export function frameVersion(info: BarkloaderFrameInfo): string {
  return createHash("sha256")
    .update(`${FRAME_DOCUMENT_REVISION}\n${JSON.stringify(info)}`)
    .digest("base64url")
    .slice(0, 16);
}

/** Stands in for a version when barkloader could not be asked; never cached. */
export const UNAVAILABLE_VERSION = "unavailable";

/**
 * `/frames/{moduleId}/{manifestId}?theme={id}&v={version}`: one widget's frame
 * document. It carries nothing about a placement (that travels in the URL's
 * fragment), so it is public, the same for every placement, and cached by
 * the browser for as long as `v` is current.
 */
export function frameDocumentUrl(
  moduleId: string,
  manifestId: string,
  themeId: string | undefined,
  version: string
): string {
  const query = new URLSearchParams();
  if (themeId) {
    query.set("theme", themeId);
  }
  query.set("v", version);
  return `/frames/${encodeURIComponent(moduleId)}/${encodeURIComponent(manifestId)}?${query}`;
}

/** How one widget and theme is framed. */
interface Framing {
  frameUrl: string;
  /** Set when the frame runs under the theme policy (see `PlacementMeta.mediaProxyBase`). */
  mediaProxyBase?: string;
  /** Set when barkloader gave no frame (see `OverlayWidgetInstance.frameUnavailable`). */
  frameUnavailable?: true;
}

/** How long an alert's framing waits before asking barkloader again for a widget it could not answer for. */
export const ALERT_FRAME_RETRY_DELAY_MS = 500;

/** An alert widget's frame could not be versioned, so its media could not be signed. */
export class AlertFrameUnavailableError extends Error {
  constructor(
    readonly widgetId: string,
    readonly canonicalId: string
  ) {
    super(`widget ${canonicalId}'s frame is unavailable`);
    this.name = "AlertFrameUnavailableError";
  }
}

type Framer = (moduleId: string, manifestId: string, themeId: string | undefined) => Promise<Framing>;

interface FramingMemo {
  framer: Framer;
  framings: Map<string, Promise<Framing>>;
  linked: Map<string, Promise<Record<string, string>>>;
}

/** Gives each placement of a scene config its frame URL and linked resources. */
export interface PlacementFraming {
  frame(instances: OverlayWidgetInstance[]): Promise<OverlayWidgetInstance[]>;
}

/** Frames the widgets of an alert's layout, as they are recorded on its delivery. */
export interface AlertFraming {
  frameAlert(layout: CompositionDocument): Promise<Record<NodeId, AlertWidgetFrame>>;
}

/**
 * Frame URLs, linked resources and media proxy bases for the placements of a
 * scene config. Each distinct widget and theme asks barkloader once per
 * config (which serves it from its frame cache), and each module's settings
 * are read once.
 */
export class FrameCatalog implements PlacementFraming, AlertFraming {
  constructor(
    private readonly barkloader: BarkloaderFrameClient,
    private readonly logger: Logger,
    private readonly linkedResources?: (moduleId: string) => Promise<Record<string, string>>,
    private readonly alertRetryDelayMs: number = ALERT_FRAME_RETRY_DELAY_MS
  ) {}

  async frame(instances: OverlayWidgetInstance[]): Promise<OverlayWidgetInstance[]> {
    const memo = this.newMemo((moduleId, manifestId, themeId) => this.framing(moduleId, manifestId, themeId));
    return Promise.all(
      instances.map(async (instance) => {
        // A placement that hosts a surface is drawn by the page, never framed.
        if (instance.hostsSurface !== "") {
          return instance;
        }
        const { framing, linkedResources } = await this.frameWidget(
          memo,
          instance.moduleId,
          instance.manifestId,
          selectedThemeId(instance.settings)
        );
        return { ...instance, ...framing, linkedResources };
      })
    );
  }

  /**
   * Each widget of an alert layout framed as a placement of it would be, so
   * an alert's frames load the same cached documents. A layout widget whose
   * canonical id does not parse cannot be framed; `parseAlertLayout` has
   * refused any such widget before an alert is framed.
   *
   * A delivery is recorded and re-sent as it was framed, with nothing to
   * frame it again, so an unversioned frame would stay unsigned for the
   * alert's whole life. A widget barkloader cannot answer for is therefore
   * asked again once, and the alert is refused if it still cannot: throws
   * `AlertFrameUnavailableError`.
   */
  async frameAlert(layout: CompositionDocument): Promise<Record<NodeId, AlertWidgetFrame>> {
    const memo = this.newMemo((moduleId, manifestId, themeId) => this.framingWithRetry(moduleId, manifestId, themeId));
    const entries = await Promise.all(
      Object.entries(layout.widgets).map(async ([widgetId, placement]): Promise<[NodeId, AlertWidgetFrame]> => {
        const canonical = parseWidgetCanonicalId(placement.widget);
        if (canonical === null) {
          throw new Error(`frameAlert: layout widget ${widgetId} has no valid canonical id`);
        }
        const { framing, linkedResources } = await this.frameWidget(
          memo,
          canonical.moduleKey,
          canonical.manifestId,
          selectedThemeId(placement.settings)
        );
        if (framing.frameUnavailable === true) {
          throw new AlertFrameUnavailableError(widgetId, placement.widget);
        }
        return [
          widgetId,
          {
            frameUrl: framing.frameUrl,
            linkedResources,
            ...(framing.mediaProxyBase === undefined ? {} : { mediaProxyBase: framing.mediaProxyBase }),
          },
        ];
      })
    );
    return Object.fromEntries(entries);
  }

  private newMemo(framer: Framer): FramingMemo {
    return { framer, framings: new Map(), linked: new Map() };
  }

  /** One widget and theme's framing and its module's linked resources, each asked for once per memo. */
  private async frameWidget(
    memo: FramingMemo,
    moduleId: string,
    manifestId: string,
    themeId: string | undefined
  ): Promise<{ framing: Framing; linkedResources: Record<string, string> }> {
    const urlKey = `${moduleId}\n${manifestId}\n${themeId ?? ""}`;
    if (!memo.framings.has(urlKey)) {
      memo.framings.set(urlKey, memo.framer(moduleId, manifestId, themeId));
    }
    if (!memo.linked.has(moduleId)) {
      memo.linked.set(moduleId, this.moduleLinks(moduleId));
    }
    return { framing: await memo.framings.get(urlKey)!, linkedResources: await memo.linked.get(moduleId)! };
  }

  private async framingWithRetry(moduleId: string, manifestId: string, themeId: string | undefined): Promise<Framing> {
    const first = await this.framing(moduleId, manifestId, themeId);
    if (first.frameUnavailable !== true) {
      return first;
    }
    await new Promise((resolve) => setTimeout(resolve, this.alertRetryDelayMs));
    return this.framing(moduleId, manifestId, themeId);
  }

  /**
   * The frame URL, versioned by barkloader's answer, and the media proxy base
   * the frame's policy calls for (`frameMediaProxyBase`). When barkloader
   * cannot be asked, or does not answer with a frame, neither is known: the
   * placement is marked `frameUnavailable` and framed again later.
   */
  private async framing(moduleId: string, manifestId: string, themeId: string | undefined): Promise<Framing> {
    let info: BarkloaderFrameInfo | null = null;
    try {
      info = await this.barkloader.fetchWidgetFrame(moduleId, manifestId, themeId);
    } catch (err) {
      this.logger.warn("barkloader frame fetch failed while versioning a frame URL", {
        moduleId,
        manifestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (info === null) {
      return { frameUrl: frameDocumentUrl(moduleId, manifestId, themeId, UNAVAILABLE_VERSION), frameUnavailable: true };
    }
    const frameUrl = frameDocumentUrl(moduleId, manifestId, themeId, frameVersion(info));
    const mediaProxyBase = frameMediaProxyBase(info);
    return mediaProxyBase === undefined ? { frameUrl } : { frameUrl, mediaProxyBase };
  }

  /** A widget still renders when its module's settings cannot be read; it
   *  then sees no linked instances, as with an older host. */
  private async moduleLinks(moduleId: string): Promise<Record<string, string>> {
    if (!this.linkedResources) {
      return {};
    }
    try {
      return await this.linkedResources(moduleId);
    } catch (err) {
      this.logger.warn("module settings unavailable; the widget sees no linked resources", {
        moduleId,
        error: err instanceof Error ? err.message : String(err),
      });
      return {};
    }
  }
}
