import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { AlertQueueManager } from "./alert-queue-manager";
import type { DbClient } from "./db";
import type { StorageBroadcaster } from "./storage-broadcaster";

interface InitArgs {
  nats: NATSClient;
  db: DbClient;
  queue: AlertQueueManager;
  storageBroadcaster: StorageBroadcaster;
  logger: SharedLogger;
}

interface ReplayResponse {
  ok: boolean;
  message: string;
  replayEnvelopeId?: string;
}

interface SkipResponse {
  skipped: boolean;
}

interface ClearResponse {
  cleared: number;
}

const encoder = new TextEncoder();

function encodeReply(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function getAppId(raw: Record<string, unknown>, subject: string, logger: SharedLogger): string | null {
  const appId = typeof raw.applicationId === "string" ? (raw.applicationId as string) : "";
  if (!appId) {
    logger.warn(`${subject} dropped — applicationId is required on the envelope`, { subject });
    return null;
  }
  return appId;
}

export async function initWidgetEventHandlers(args: InitArgs): Promise<void> {
  const { nats, db, queue, storageBroadcaster, logger } = args;

  // ── ui.notify.alert ────────────────────────────────────────────
  // Workflow alert action publishes here. We persist the envelope to
  // the alerts table and hand it to the queue manager.
  await nats.subscribe("ui.notify.alert", async (msg) => {
    try {
      const rawPayload = msg.json() as Record<string, unknown>;
      const payloadJson = JSON.stringify(rawPayload);

      const appId = getAppId(rawPayload, msg.subject, logger);
      if (!appId) return;

      const params = (rawPayload.parameters as Record<string, unknown> | undefined) ?? {};
      const envelopeId =
        typeof rawPayload.id === "string"
          ? (rawPayload.id as string)
          : typeof params.id === "string"
            ? (params.id as string)
            : "";
      const workflowId = typeof rawPayload.workflow_id === "string" ? (rawPayload.workflow_id as string) : "";
      const sourceEventId =
        typeof rawPayload.source_event_id === "string" ? (rawPayload.source_event_id as string) : "";

      await db.createAlert({
        applicationId: appId,
        payload: payloadJson,
        workflowId,
        sourceEventId,
        envelopeId,
      });
      logger.info("alert recorded", {
        applicationId: appId,
        envelopeId,
        workflowId,
        sourceEventId,
      });

      if (envelopeId) {
        await queue.enqueue({
          id: envelopeId,
          applicationId: appId,
          parameters: params,
          event: rawPayload.event,
          rawJson: payloadJson,
        });
      } else {
        logger.warn("alert has no envelope id; skipping queue (broadcast disabled)", {
          applicationId: appId,
          workflowId,
        });
      }

      const event = rawPayload.event as Record<string, unknown> | null | undefined;
      if (event && typeof event === "object") {
        const eventType = typeof event.type === "string" ? (event.type as string) : "";
        if (eventType) {
          storageBroadcaster.broadcastEvent({
            kind: "event",
            type: eventType,
            source: typeof event.source === "string" ? (event.source as string) : "",
            time: typeof event.time === "string" ? (event.time as string) : new Date().toISOString(),
            data: event.data ?? null,
          });
        }
      }
    } catch (err) {
      logger.error("Failed to handle ui.notify.alert", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
  logger.info("Subscribed to ui.notify.alert");

  // ── widget.event (R2: unified inbound channel) ─────────────────
  await nats.subscribe("widget.event", async (msg) => {
    try {
      const ce = msg.json() as Record<string, unknown>;
      const data = (ce.data as Record<string, unknown> | undefined) ?? {};
      const moduleId = typeof data.moduleId === "string" ? (data.moduleId as string) : "";
      const instanceId = typeof data.instanceId === "string" ? (data.instanceId as string) : "";
      const key = typeof data.key === "string" ? (data.key as string) : "";
      if (!moduleId || !instanceId || !key) {
        logger.warn("widget.event: missing required fields; dropping", {
          moduleId,
          instanceId,
          key,
        });
        return;
      }

      const appId = getAppId(data, msg.subject, logger);
      if (!appId) return;

      const widgetCanonicalId = typeof data.widgetCanonicalId === "string" ? (data.widgetCanonicalId as string) : "";
      const occurredAt = typeof data.occurredAt === "string" ? (data.occurredAt as string) : new Date().toISOString();

      if (key === "alert.lifecycle" && instanceId === "alert-overlay") {
        const value = (data.value as Record<string, unknown> | undefined) ?? {};
        const envelopeId = typeof value.envelopeId === "string" ? (value.envelopeId as string) : "";
        const state = value.state;
        if (!envelopeId) {
          logger.warn("alert.lifecycle: missing envelopeId; dropping", { value });
          return;
        }
        if (state !== "playing" && state !== "completed" && state !== "failed") {
          logger.warn("alert.lifecycle: invalid state", { envelopeId, state });
          return;
        }
        const errorMsg = typeof value.error === "string" ? (value.error as string) : "";
        await queue.handleStatus(appId, envelopeId, state, errorMsg);
        logger.info("alert lifecycle updated", {
          applicationId: appId,
          envelopeId,
          status: state,
          error: errorMsg || undefined,
        });
        return;
      }

      const valueJson = JSON.stringify(data.value ?? null);
      try {
        await db.upsertWidgetStatus({
          applicationId: appId,
          moduleId,
          instanceId,
          widgetCanonicalId,
          key,
          value: valueJson,
          occurredAt,
        });
      } catch (err) {
        logger.error("widget.event: db upsert failed", {
          moduleId,
          instanceId,
          key,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      logger.info("widget status persisted", {
        applicationId: appId,
        moduleId,
        instanceId,
        key,
      });
    } catch (err) {
      logger.error("widget.event: handler failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
  logger.info("Subscribed to widget.event");

  // ── operator controls (NATS request/reply) ─────────────────────
  await nats.subscribe("widget.queue.skip", async (msg) => {
    if (!msg.reply) {
      logger.warn("widget.queue.skip: no reply subject; dropping");
      return;
    }
    try {
      const req = msg.json() as { applicationId: string };
      const appId = req.applicationId;
      if (!appId) {
        msg.respond(encodeReply({ skipped: false } satisfies SkipResponse));
        return;
      }
      const skipped = await queue.skipCurrent(appId);
      msg.respond(encodeReply({ skipped } satisfies SkipResponse));
    } catch (err) {
      logger.error("widget.queue.skip failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      msg.respond(encodeReply({ skipped: false } satisfies SkipResponse));
    }
  });
  logger.info("Subscribed to widget.queue.skip");

  await nats.subscribe("widget.queue.clear", async (msg) => {
    if (!msg.reply) {
      logger.warn("widget.queue.clear: no reply subject; dropping");
      return;
    }
    try {
      const req = msg.json() as { applicationId: string };
      const appId = req.applicationId;
      if (!appId) {
        msg.respond(encodeReply({ cleared: 0 } satisfies ClearResponse));
        return;
      }
      const cleared = await queue.clearPending(appId);
      msg.respond(encodeReply({ cleared } satisfies ClearResponse));
    } catch (err) {
      logger.error("widget.queue.clear failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      msg.respond(encodeReply({ cleared: 0 } satisfies ClearResponse));
    }
  });
  logger.info("Subscribed to widget.queue.clear");

  await nats.subscribe("widget.queue.replay", async (msg) => {
    if (!msg.reply) {
      logger.warn("widget.queue.replay: no reply subject; dropping");
      return;
    }
    try {
      const req = msg.json() as { id?: string };
      const id = req.id;
      if (!id) {
        msg.respond(
          encodeReply({
            ok: false,
            message: "alert id is required",
          } satisfies ReplayResponse)
        );
        return;
      }
      const response = await db.getAlert({ id });
      if (response.status?.code !== "OK" || !response.alert) {
        msg.respond(
          encodeReply({
            ok: false,
            message: "alert not found",
          } satisfies ReplayResponse)
        );
        return;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(response.alert.payload);
      } catch (err) {
        msg.respond(
          encodeReply({
            ok: false,
            message: "stored payload is not valid JSON",
          } satisfies ReplayResponse)
        );
        return;
      }
      if (!payload || typeof payload !== "object") {
        msg.respond(
          encodeReply({
            ok: false,
            message: "stored payload is not an object",
          } satisfies ReplayResponse)
        );
        return;
      }
      const payloadObj = payload as Record<string, unknown>;
      if (typeof payloadObj.applicationId !== "string" || !payloadObj.applicationId) {
        msg.respond(
          encodeReply({
            ok: false,
            message: "original alert payload is missing applicationId; cannot replay",
          } satisfies ReplayResponse)
        );
        return;
      }
      const replayEnvelopeId = crypto.randomUUID();
      const replayPayload = { ...payloadObj, id: replayEnvelopeId };
      await nats.publish("ui.notify.alert", encodeReply(replayPayload));
      await db.updateAlertStatus({ id, status: "replayed" });
      logger.info("alert replayed", { id, replayEnvelopeId });
      msg.respond(
        encodeReply({
          ok: true,
          message: "Alert re-enqueued",
          replayEnvelopeId,
        } satisfies ReplayResponse)
      );
    } catch (err) {
      logger.error("widget.queue.replay failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      msg.respond(
        encodeReply({
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        } satisfies ReplayResponse)
      );
    }
  });
  logger.info("Subscribed to widget.queue.replay");
}
