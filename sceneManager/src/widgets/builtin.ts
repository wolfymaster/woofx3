import type { ConfigField } from "@woofx3/api/ui-schema";
import { EventType } from "@woofx3/common/cloudevents/Twitch";
import type { WidgetDefinition } from "@woofx3/api/webhooks";
import type { Logger } from "@woofx3/common/runtime";
import type { createMessageBus } from "@woofx3/nats";
import type { DbClient } from "../db";

/**
 * Spec shape for a built-in woofx3 widget. Each entry produces a
 * canonical `WidgetDefinition` at registration time — mirroring the
 * shape a module-packaged widget would produce from its `manifest.json`.
 * Assets are served from the local `public/widgets/builtin/` directory
 * rather than through barkloader's repository (see frame-assembler.ts).
 *
 * Adding a new built-in widget is a single entry in `BUILTIN_WIDGET_SPECS`
 * below. No manifest.json, no module zip, no db-proxy migration required.
 */
export interface BuiltinWidgetSpec {
  manifestId: string;
  name: string;
  description?: string;
  directory: string;
  alertTypes: string[];
  /**
   * CloudEvent types the widget receives in scene context, matched
   * verbatim against the alert envelope's `event.type`.
   */
  acceptedEvents: string[];
  settings: ConfigField[];
  surface?: "scene" | "dashboard";
}

const BUILTIN_WIDGET_SPECS: BuiltinWidgetSpec[] = [
  {
    manifestId: "media_alert",
    name: "Media Alert",
    description:
      "Renders alert text, media, and audio with expression-based template " +
      "substitution. Handles all standard Twitch event types (raid, follow, " +
      "subscription, redeem, etc.).",
    directory: "builtin/media_alert",
    alertTypes: ["stream_online", "stream_offline", "raid", "follow", "subscription", "subscription_gift", "redeem"],
    // `fanOutToConnectedScenes` compares these verbatim against the
    // alert envelope's `event.type`, which `buildAlertEnvelope` sets to
    // the originating CloudEvent's type — not to a canonical
    // `{module}:trigger:{id}` reference. An entry matching no emitted
    // type is dropped silently, so these are taken from the shared
    // enum rather than written out by hand: a renamed event breaks the
    // build instead of the alerts.
    acceptedEvents: [
      EventType.Follow,
      EventType.Cheer,
      EventType.Subscribe,
      EventType.SubscriptionGift,
      EventType.Redeem,
      EventType.Raid,
      EventType.StreamOnline,
      EventType.StreamOffline,
    ],
    settings: [
      { id: "textTemplate", type: "text", label: "Alert text template", defaultValue: "" },
      { id: "mediaUrlTemplate", type: "text", label: "Media URL template", defaultValue: "" },
      { id: "audioUrlTemplate", type: "text", label: "Audio URL template", defaultValue: "" },
      { id: "duration", type: "number", label: "Display duration (seconds)", defaultValue: 5 },
    ],
    surface: "scene",
  },
];

/** Build canonical `WidgetDefinition` objects from the built-in specs. */
export function buildBuiltinWidgetDefinitions(): WidgetDefinition[] {
  return BUILTIN_WIDGET_SPECS.map((spec) => ({
    id: `builtin:widget:${spec.manifestId}`,
    canonicalId: `builtin:widget:${spec.manifestId}`,
    projectionKey: `builtin:widget:${spec.manifestId}`,
    manifestId: spec.manifestId,
    name: spec.name,
    description: spec.description,
    directory: spec.directory,
    alertTypes: spec.alertTypes,
    settings: spec.settings,
    surface: spec.surface,
    createdByType: "SYSTEM",
    createdByRef: "builtin",
  }));
}

/**
 * Return the raw specs — the client-side scene manager builds its
 * renderer registry from these, and `scene-host.ts` uses them as the
 * `acceptedEvents` fallback for built-in placements that predate this
 * field being stored per-instance.
 */
export function getBuiltinWidgetSpecs(): BuiltinWidgetSpec[] {
  return BUILTIN_WIDGET_SPECS;
}

/**
 * Initialise built-in widgets at sceneManager startup:
 *
 * 1. Log which built-in definitions are available.
 * 2. If a db-proxy client is provided, call RegisterWidgets RPC so the
 *    db-proxy persists the widgets and publishes a `module.widget.registered`
 *    outbox event.
 * 3. ALWAYS publish to NATS directly so widgets appear even without db.
 *
 * Idempotent across restarts: the db-proxy upserts on
 * (created_by_type, created_by_ref, manifest_id).
 */
export async function initBuiltinWidgets(
  logger: Logger,
  db: DbClient | null,
  nats: Awaited<ReturnType<typeof createMessageBus>> | null
): Promise<void> {
  const defs = buildBuiltinWidgetDefinitions();
  logger.info(`Built-in widgets available: ${defs.map((d) => d.canonicalId).join(", ") || "none"}`);

  if (!defs.length) {
    return;
  }

  const widgetPayload = defs.map((d) => ({
    manifest_id: d.manifestId,
    name: d.name,
    description: d.description ?? "",
    directory: d.directory,
    alert_types: d.alertTypes,
    settings_schema: JSON.stringify(d.settings),
    surface: d.surface ?? "scene",
    canonical_id: d.canonicalId,
    projection_key: d.projectionKey,
    created_by_type: d.createdByType,
    created_by_ref: d.createdByRef,
  }));

  if (db) {
    try {
      const response = await db.registerWidgets({
        moduleId: "builtin",
        moduleKey: "builtin",
        moduleName: "Built-in",
        version: "1.0.0",
        applicationId: "",
        createdByType: "SYSTEM",
        createdByRef: "builtin",
        widgets: defs.map((d) => ({
          manifestId: d.manifestId,
          name: d.name,
          description: d.description ?? "",
          directory: d.directory,
          entry: "",
          alertTypes: d.alertTypes,
          settingsSchema: JSON.stringify(d.settings),
          surface: d.surface ?? "scene",
        })),
      });
      logger.info(`Registered ${defs.length} built-in widgets via db-proxy`, {
        status: response.status?.code,
        widgetCount: defs.length,
      });
    } catch (err) {
      logger.error("Failed to register built-in widgets via db-proxy", {
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : typeof err,
      });
    }
  } else {
    logger.warn("DbClient not available; using NATS-only widget registration");
  }

  if (nats) {
    try {
      const ce = {
        specversion: "1.0",
        type: "module.widget.registered",
        source: "woofx3://scene-manager/builtin-widgets",
        id: `builtin-widgets-${Date.now()}`,
        time: new Date().toISOString(),
        data: {
          module_key: "builtin",
          module_name: "Built-in",
          version: "1.0.0",
          created_by_type: "SYSTEM",
          created_by_ref: "builtin",
          widgets: widgetPayload,
        },
      };
      await nats.publish("db.module.widget.registered.builtin", new TextEncoder().encode(JSON.stringify(ce)));
      logger.info(`Published ${defs.length} built-in widgets to NATS`);
    } catch (err) {
      logger.error("Failed to publish built-in widgets to NATS", {
        message: err instanceof Error ? err.message : String(err),
        name: err instanceof Error ? err.name : typeof err,
      });
    }
  } else {
    logger.warn("NATS not available; built-in widgets will not appear in scene manager");
  }
}
