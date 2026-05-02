import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { AlertBroadcaster, AlertPayload } from "./alert-broadcaster";
import { handleLegacySlobsCommand } from "./obs-commands";
import type Manager from "./obs/manager";

interface InitArgs {
  nats: NATSClient | null;
  obs: Manager | null;
  broadcaster: AlertBroadcaster;
  logger: SharedLogger;
}

export async function initSubscriptions({ nats, obs, broadcaster, logger }: InitArgs): Promise<void> {
  if (!nats) {
    logger.warn("NATS unavailable — alert subscription skipped (overlay will receive nothing)");
    return;
  }

  // Workflow `alert` action publishes raw JSON here (workflow/actions.go:NewAlertAction).
  await nats.subscribe("ui.notify.alert", (msg) => {
    let payload: AlertPayload;
    try {
      payload = msg.json<AlertPayload>();
    } catch (err) {
      logger.error("ui.notify.alert: malformed JSON payload", {
        error: err instanceof Error ? err.message : String(err),
        raw: msg.string().slice(0, 200),
      });
      return;
    }
    broadcaster.broadcast(payload);
  });
  logger.info("Subscribed to ui.notify.alert");

  // Legacy slobs subject: kept temporarily so chat-bot scene/source
  // triggers don't break. Drop once everything moves to workflow actions.
  await nats.subscribe("slobs", (msg) => {
    let body: { command: string; args: Record<string, string> };
    try {
      body = msg.json();
    } catch (err) {
      logger.error("slobs: malformed JSON payload", {
        error: err instanceof Error ? err.message : String(err),
        raw: msg.string().slice(0, 200),
      });
      return;
    }
    handleLegacySlobsCommand(obs, body, logger).catch((err) => {
      logger.error("Legacy slobs command failed", {
        command: body.command,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });
  logger.info("Subscribed to slobs (legacy OBS bridge)");
}
