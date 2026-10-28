import type { SceneCreatedEvent, SceneDeletedEvent, SceneSnapshot, SceneUpdatedEvent } from "@woofx3/api/webhooks";
import { EngineEventType } from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import { asString, pickFirst, readRow } from "./outbox";
import { subscribeProjections } from "./projection";
import { compositionKindOf } from "./routes/helpers";
import type { WebhookClient } from "./webhook-client";

// The db proxy publishes scene lifecycle events on
// `db.scene.{created,updated,deleted}`. The CloudEvent's `data`
// is the snake_cased map produced by `buildSceneChangeData` in
// `db/app/services/scene_service.go`. We accept both the snake_case
// shape and Go's default JSON casing (`ID`, `Name`, ...) so a future
// shift to raw model marshaling stays compatible — same defensive
// approach `parseWorkflowCreated` takes.

interface RawSceneRow {
  ID?: unknown;
  id?: unknown;
  Kind?: unknown;
  kind?: unknown;
  Name?: unknown;
  name?: unknown;
  Description?: unknown;
  description?: unknown;
  WidgetsJSON?: unknown;
  widgets_json?: unknown;
  LayoutJSON?: unknown;
  layout_json?: unknown;
  BehaviorsJSON?: unknown;
  behaviors_json?: unknown;
  InputsJSON?: unknown;
  inputs_json?: unknown;
  CreatedByType?: unknown;
  created_by_type?: unknown;
  CreatedByRef?: unknown;
  created_by_ref?: unknown;
  CreatedAt?: unknown;
  created_at?: unknown;
  UpdatedAt?: unknown;
  updated_at?: unknown;
}

function buildSnapshot(ce: Record<string, unknown>): SceneSnapshot | null {
  const row = readRow<RawSceneRow>(ce);
  const id = pickFirst(row.ID, row.id);
  if (id === "") {
    return null;
  }
  // A row from a db-proxy that predates scene timestamps carries none;
  // consumers upsert by them, so it is stamped with the time it arrived.
  const now = new Date().toISOString();
  const widgetsJson = pickFirst(row.WidgetsJSON, row.widgets_json) || "[]";
  const layoutJson = pickFirst(row.LayoutJSON, row.layout_json) || "{}";
  return {
    id,
    kind: compositionKindOf(pickFirst(row.Kind, row.kind)),
    name: pickFirst(row.Name, row.name),
    description: pickFirst(row.Description, row.description),
    widgetsJson,
    layoutJson,
    behaviorsJson: pickFirst(row.BehaviorsJSON, row.behaviors_json) || "{}",
    inputsJson: pickFirst(row.InputsJSON, row.inputs_json) || "[]",
    createdByType: pickFirst(row.CreatedByType, row.created_by_type) || "USER",
    createdByRef: pickFirst(row.CreatedByRef, row.created_by_ref),
    createdAt: pickFirst(row.CreatedAt, row.created_at) || now,
    updatedAt: pickFirst(row.UpdatedAt, row.updated_at) || now,
  };
}

export interface ParsedSceneChange<T> {
  clientId: string;
  event: T | null;
}

export function parseSceneCreated(ce: Record<string, unknown>): ParsedSceneChange<SceneCreatedEvent> {
  const clientId = asString(ce.client_id);
  const snapshot = buildSnapshot(ce);
  return {
    clientId,
    event: snapshot
      ? {
          type: EngineEventType.SCENE_CREATED,
          scene: snapshot,
        }
      : null,
  };
}

export function parseSceneUpdated(ce: Record<string, unknown>): ParsedSceneChange<SceneUpdatedEvent> {
  const clientId = asString(ce.client_id);
  const snapshot = buildSnapshot(ce);
  return {
    clientId,
    event: snapshot
      ? {
          type: EngineEventType.SCENE_UPDATED,
          scene: snapshot,
        }
      : null,
  };
}

export function parseSceneDeleted(ce: Record<string, unknown>): ParsedSceneChange<SceneDeletedEvent> {
  const row = readRow<RawSceneRow>(ce);
  const clientId = asString(ce.client_id);
  // scene_service.DeleteScene publishes the full row (its
  // `buildSceneChangeData`), so the id field is always present.
  // Fall back to the CloudEvent `entity_id` extension defensively
  // — same convention `parseWorkflowDeleted` follows.
  const sceneId = pickFirst(row.ID, row.id, ce.entity_id);
  if (!sceneId) {
    return { clientId, event: null };
  }
  return {
    clientId,
    event: {
      type: EngineEventType.SCENE_DELETED,
      sceneId,
      kind: compositionKindOf(pickFirst(row.Kind, row.kind)),
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
  await subscribeProjections({ nats, webhookClient, logger }, [
    {
      subject: "db.scene.created.*",
      name: "db.scene.created",
      parse: (ce) => {
        const { clientId, event } = parseSceneCreated(ce);
        return event ? { event, clientId } : null;
      },
    },
    {
      subject: "db.scene.updated.*",
      name: "db.scene.updated",
      parse: (ce) => {
        const { clientId, event } = parseSceneUpdated(ce);
        return event ? { event, clientId } : null;
      },
    },
    {
      subject: "db.scene.deleted.*",
      name: "db.scene.deleted",
      parse: (ce) => {
        const { clientId, event } = parseSceneDeleted(ce);
        return event ? { event, clientId } : null;
      },
    },
  ]);
}
