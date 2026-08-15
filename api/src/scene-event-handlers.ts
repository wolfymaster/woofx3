import type {
  SceneCreatedEvent,
  SceneDeletedEvent,
  SceneSnapshot,
  SceneUpdatedEvent,
} from "@woofx3/api/webhooks";
import { EngineEventType } from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { WebhookClient } from "./webhook-client";

// The db proxy publishes scene lifecycle events on
// `db.scene.{created,updated,deleted}.{appId}`. The CloudEvent's `data`
// is the snake_cased map produced by `buildSceneChangeData` in
// `db/app/services/scene_service.go`. We accept both the snake_case
// shape and Go's default JSON casing (`ID`, `Name`, ...) so a future
// shift to raw model marshaling stays compatible — same defensive
// approach `parseWorkflowCreated` takes.

interface RawSceneRow {
  ID?: unknown;
  id?: unknown;
  Name?: unknown;
  name?: unknown;
  Description?: unknown;
  description?: unknown;
  ApplicationID?: unknown;
  application_id?: unknown;
  WidgetsJSON?: unknown;
  widgets_json?: unknown;
  LayoutJSON?: unknown;
  layout_json?: unknown;
  CreatedByType?: unknown;
  created_by_type?: unknown;
  CreatedByRef?: unknown;
  created_by_ref?: unknown;
}

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

function pickFirst(...values: unknown[]): string {
  for (const v of values) {
    const s = asString(v);
    if (s !== "") {
      return s;
    }
  }
  return "";
}

function readRow(ce: Record<string, unknown>): RawSceneRow {
  const data = ce.data;
  if (data && typeof data === "object") {
    return data as RawSceneRow;
  }
  return ce as RawSceneRow;
}

function buildSnapshot(ce: Record<string, unknown>): SceneSnapshot | null {
  const row = readRow(ce);
  const id = pickFirst(row.ID, row.id);
  if (id === "") {
    return null;
  }
  // The `scenes` row carries no createdAt / updatedAt columns on the
  // typed model today (gorm-managed but unprojected — same gap as
  // `workflowToProto`). Synthesize ISO timestamps so consumers can
  // upsert without conditionally sniffing for missing fields.
  const now = new Date().toISOString();
  const widgetsJson = pickFirst(row.WidgetsJSON, row.widgets_json) || "[]";
  const layoutJson = pickFirst(row.LayoutJSON, row.layout_json) || "{}";
  return {
    id,
    applicationId: pickFirst(row.ApplicationID, row.application_id),
    name: pickFirst(row.Name, row.name),
    description: pickFirst(row.Description, row.description),
    widgetsJson,
    layoutJson,
    createdByType: pickFirst(row.CreatedByType, row.created_by_type) || "USER",
    createdByRef: pickFirst(row.CreatedByRef, row.created_by_ref),
    createdAt: now,
    updatedAt: now,
  };
}

export interface ParsedSceneChange<T> {
  applicationId: string;
  clientId: string;
  event: T | null;
}

export function parseSceneCreated(
  ce: Record<string, unknown>
): ParsedSceneChange<SceneCreatedEvent> {
  const row = readRow(ce);
  const applicationId = pickFirst(row.ApplicationID, row.application_id);
  const clientId = asString(ce.client_id);
  const snapshot = buildSnapshot(ce);
  return {
    applicationId,
    clientId,
    event: snapshot
      ? {
          type: EngineEventType.SCENE_CREATED,
          applicationId,
          scene: snapshot,
        }
      : null,
  };
}

export function parseSceneUpdated(
  ce: Record<string, unknown>
): ParsedSceneChange<SceneUpdatedEvent> {
  const row = readRow(ce);
  const applicationId = pickFirst(row.ApplicationID, row.application_id);
  const clientId = asString(ce.client_id);
  const snapshot = buildSnapshot(ce);
  return {
    applicationId,
    clientId,
    event: snapshot
      ? {
          type: EngineEventType.SCENE_UPDATED,
          applicationId,
          scene: snapshot,
        }
      : null,
  };
}

export function parseSceneDeleted(
  ce: Record<string, unknown>
): ParsedSceneChange<SceneDeletedEvent> {
  const row = readRow(ce);
  const applicationId = pickFirst(row.ApplicationID, row.application_id);
  const clientId = asString(ce.client_id);
  // scene_service.DeleteScene publishes the full row (its
  // `buildSceneChangeData`), so the id field is always present.
  // Fall back to the CloudEvent `entity_id` extension defensively
  // — same convention `parseWorkflowDeleted` follows.
  const sceneId = pickFirst(row.ID, row.id, ce.entity_id);
  if (!sceneId) {
    return { applicationId, clientId, event: null };
  }
  return {
    applicationId,
    clientId,
    event: {
      type: EngineEventType.SCENE_DELETED,
      applicationId,
      sceneId,
    },
  };
}

/**
 * Initialise NATS subscriptions for the scene CRUD outbox
 * (`db.scene.{created,updated,deleted}.*`) and project each onto
 * webhook callbacks, so Convex can sync its scene editor without
 * polling.
 */
export async function initSceneHandlers(
  nats: NATSClient,
  webhookClient: WebhookClient,
  logger: SharedLogger
): Promise<void> {
  await nats.subscribe("db.scene.created.*", async (msg) => {
    try {
      const ce = msg.json() as Record<string, unknown>;
      const { clientId, event } = parseSceneCreated(ce);
      if (!event) {
        logger.warn("scene.created payload missing required fields, skipping");
        return;
      }
      await webhookClient.send(event, clientId || undefined);
    } catch (err) {
      logger.error("Failed to handle scene.created NATS event", { err });
    }
  });

  await nats.subscribe("db.scene.updated.*", async (msg) => {
    try {
      const ce = msg.json() as Record<string, unknown>;
      const { clientId, event } = parseSceneUpdated(ce);
      if (!event) {
        logger.warn("scene.updated payload missing required fields, skipping");
        return;
      }
      await webhookClient.send(event, clientId || undefined);
    } catch (err) {
      logger.error("Failed to handle scene.updated NATS event", { err });
    }
  });

  await nats.subscribe("db.scene.deleted.*", async (msg) => {
    try {
      const ce = msg.json() as Record<string, unknown>;
      const { clientId, event } = parseSceneDeleted(ce);
      if (!event) {
        logger.warn("scene.deleted payload missing scene id, skipping");
        return;
      }
      await webhookClient.send(event, clientId || undefined);
    } catch (err) {
      logger.error("Failed to handle scene.deleted NATS event", { err });
    }
  });

  logger.info("Scene event NATS handlers initialized");
}
