import { createHash } from "node:crypto";
import type { Logger } from "@woofx3/common/runtime";
import type { BarkloaderFrameClient, BarkloaderFrameInfo } from "./frame-assembler";
import type { OverlayWidgetInstance } from "./scene-host";
import { selectedThemeId } from "./widget-theme";

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

/** Gives each placement of a scene config its frame URL and linked resources. */
export interface PlacementFraming {
  frame(instances: OverlayWidgetInstance[]): Promise<OverlayWidgetInstance[]>;
}

/**
 * Frame URLs and linked resources for the placements of a scene config. Each
 * distinct widget and theme asks barkloader once per config (which serves it
 * from its frame cache), and each module's settings are read once.
 */
export class FrameCatalog implements PlacementFraming {
  constructor(
    private readonly barkloader: BarkloaderFrameClient,
    private readonly logger: Logger,
    private readonly linkedResources?: (moduleId: string) => Promise<Record<string, string>>
  ) {}

  async frame(instances: OverlayWidgetInstance[]): Promise<OverlayWidgetInstance[]> {
    const urls = new Map<string, Promise<string>>();
    const linked = new Map<string, Promise<Record<string, string>>>();
    return Promise.all(
      instances.map(async (instance) => {
        // A placement that hosts a surface is drawn by the page, never framed.
        if (instance.hostsSurface !== "") {
          return instance;
        }
        const themeId = selectedThemeId(instance.settings);
        const urlKey = `${instance.moduleId}\n${instance.manifestId}\n${themeId ?? ""}`;
        if (!urls.has(urlKey)) {
          urls.set(urlKey, this.frameUrl(instance.moduleId, instance.manifestId, themeId));
        }
        if (!linked.has(instance.moduleId)) {
          linked.set(instance.moduleId, this.moduleLinks(instance.moduleId));
        }
        return {
          ...instance,
          frameUrl: await urls.get(urlKey)!,
          linkedResources: await linked.get(instance.moduleId)!,
        };
      })
    );
  }

  private async frameUrl(moduleId: string, manifestId: string, themeId: string | undefined): Promise<string> {
    let version = UNAVAILABLE_VERSION;
    try {
      const info = await this.barkloader.fetchWidgetFrame(moduleId, manifestId, themeId);
      if (info) {
        version = frameVersion(info);
      }
    } catch (err) {
      this.logger.warn("barkloader frame fetch failed while versioning a frame URL", {
        moduleId,
        manifestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return frameDocumentUrl(moduleId, manifestId, themeId, version);
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
