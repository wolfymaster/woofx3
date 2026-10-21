// The engine's widget catalog: every installed widget, cached for a short
// while, and what a scene's placements resolve to in it.

import type { Logger } from "@woofx3/common/runtime";
import type { DeclaredBehaviorKinds } from "@woofx3/scene/model";
import type * as module_widget from "@woofx3/db/module_widget.pb";
import type { OverlayWidgetDefinition, OverlayWidgetInstance } from "./scene-host";

export interface WidgetCatalogDb {
  listWidgets(req: module_widget.ListWidgetsRequest): Promise<module_widget.ListWidgetsResponse>;
}

export interface WidgetCatalogOptions {
  /** How long a catalog read is reused, in milliseconds (default 30s). */
  ttlMs?: number;
  now?: () => number;
}

const WIDGET_CACHE_TTL_MS = 30_000;

export class WidgetCatalog {
  private cache: { rows: OverlayWidgetDefinition[]; expiresAt: number } | null = null;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly db: WidgetCatalogDb | null,
    private readonly logger: Logger,
    options: WidgetCatalogOptions = {}
  ) {
    this.ttlMs = options.ttlMs ?? WIDGET_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /** The widget catalog, cached for the TTL. Empty when the lookup fails. */
  async rows(): Promise<OverlayWidgetDefinition[]> {
    if (this.cache && this.cache.expiresAt > this.now()) {
      return this.cache.rows;
    }
    if (!this.db) {
      return [];
    }
    try {
      const response = await this.db.listWidgets({ createdByType: "", createdByRef: "" });
      const rows: OverlayWidgetDefinition[] = (response.widgets ?? []).map((w) => ({
        moduleKey: w.moduleId,
        manifestId: w.manifestId,
        entry: w.entry ?? "",
        surfaces: w.surfaces ?? [],
        hostsSurface: w.hostsSurface ?? "",
        behaviorKinds: declaredKindsOf(w.behaviorKinds),
      }));
      this.cache = { rows, expiresAt: this.now() + this.ttlMs };
      return rows;
    } catch (err) {
      this.logger.warn("widget catalog load failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return this.cache?.rows ?? [];
    }
  }

  /**
   * Resolve each placement against the widget catalog: whether its widget
   * still exists, and which surface it hosts. Says so once per unresolvable
   * placement.
   *
   * Checked on load rather than at render time because this is the only point
   * that sees the whole scene: one warning naming every dead placement is
   * actionable, where a per-frame miss is a line someone has to correlate.
   *
   * The hosted surface comes from the definition, never the placement: a
   * placement is a reference, and a copy stored on it would freeze what the
   * widget was at the moment it was placed.
   */
  async resolve(instances: OverlayWidgetInstance[], sceneId: string): Promise<OverlayWidgetInstance[]> {
    if (instances.length === 0) {
      return instances;
    }
    const catalog = await this.rows();
    // An empty catalog means the lookup failed, not that every widget is gone:
    // a transient db blip must not mark the whole scene broken.
    if (catalog.length === 0) {
      return instances.map((instance) => ({ ...instance, resolved: true }));
    }

    const byCanonicalId = new Map(catalog.map((row) => [`${row.moduleKey}:widget:${row.manifestId}`, row]));
    const resolved = instances.map((instance) => {
      const definition = byCanonicalId.get(instance.widgetCanonicalId);
      return {
        ...instance,
        hostsSurface: definition?.hostsSurface ?? "",
        ...(definition === undefined ? {} : { behaviorKinds: definition.behaviorKinds }),
        resolved: definition !== undefined,
      };
    });

    const dead = resolved.filter((instance) => !instance.resolved);
    if (dead.length > 0) {
      this.logger.warn("scene has widget placements that resolve to nothing", {
        sceneId,
        count: dead.length,
        placements: dead.map((instance) => ({
          instanceId: instance.id,
          widgetCanonicalId: instance.widgetCanonicalId,
        })),
      });
    }
    return resolved;
  }
}

/** A catalog row's declared kinds, ids only: what a page decides delegation on. */
function declaredKindsOf(kinds: module_widget.WidgetBehaviorKinds | null | undefined): DeclaredBehaviorKinds {
  return {
    transitions: (kinds?.transitions ?? []).map((kind) => kind.id),
    effects: (kinds?.effects ?? []).map((kind) => kind.id),
  };
}
