import { registerWidget } from "./index";
import { legacyAliasWidget, MEDIA_ALERT_LEGACY_ID } from "./media-alert";

/**
 * Minimal wire shape matching the backend's `WidgetDefinition`
 * (defined in `shared/clients/typescript/api/webhooks.ts`). We
 * re-declare only the fields the UI needs here rather than importing
 * from a package the SPA bundler can't resolve at build time.
 *
 * Keep this in sync with the canonical type when adding new fields
 * the frontend inspects.
 */
interface BuiltinWidgetDef {
  manifestId: string;
  name: string;
  /** @default "scene" */
  surface?: "scene" | "dashboard";
}

/**
 * Map from a built-in widget's `manifestId` to its renderer module.
 * This is the single place to wire up a new built-in widget's
 * frontend renderer.
 *
 * To add a new built-in widget:
 *   1. Add its `BuiltinWidgetSpec` to the backend array in
 *      `streamware/src/builtin-widgets.ts`.
 *   2. Create a renderer module in this directory (e.g. `my-widget.ts`)
 *      exporting a `Widget` with `id` matching the `manifestId`.
 *   3. Add the import + entry to `RENDERER_MAP` below.
 */
const RENDERER_MAP: Record<string, () => Promise<{ default: import("./index").Widget }>> = {
  media_alert: () => import("./media-alert").then((m) => ({ default: m.mediaAlertWidget })),
};

/**
 * Fetch built-in widget definitions from the streamware backend and
 * register their renderers. Idempotent: any widget whose id is already
 * in the `WIDGETS` registry is skipped.
 *
 * Resolution order:
 *   1. Fetch `/api/builtin-widgets` → `WidgetDefinition[]`
 *   2. For each definition whose `manifestId` has a renderer in
 *      `RENDERER_MAP` and is NOT already registered, call
 *      `registerWidget()`.
 *
 * Legacy aliases (e.g. "MediaWidget" → "media_alert") are also
 * registered here so existing workflow alert actions continue to work.
 */
export async function initBuiltinWidgets(): Promise<void> {
  try {
    const response = await fetch("/api/builtin-widgets");
    if (!response.ok) {
      console.warn("[builtin-widgets] failed to fetch definitions", {
        status: response.status,
      });
      return;
    }

    const definitions: BuiltinWidgetDef[] = await response.json();
    let registered = 0;

    for (const def of definitions) {
      const rendererFactory = RENDERER_MAP[def.manifestId];
      if (!rendererFactory) {
        console.warn("[builtin-widgets] no renderer for manifestId", {
          manifestId: def.manifestId,
          name: def.name,
        });
        continue;
      }

      const isNew = registerWidget((await rendererFactory()).default);
      if (isNew) {
        registered++;
        console.debug("[builtin-widgets] registered", {
          id: def.manifestId,
          name: def.name,
        });
      }
    }

    // Register legacy aliases so existing workflows referencing the old
    // widget ids continue to resolve.
    if (!(MEDIA_ALERT_LEGACY_ID in (await import("./index")).WIDGETS)) {
      registerWidget(legacyAliasWidget);
      registered++;
    }

    if (registered > 0) {
      console.info("[builtin-widgets] initialised", { registered });
    }
  } catch (err) {
    console.error("[builtin-widgets] initialisation failed", err);
  }
}
