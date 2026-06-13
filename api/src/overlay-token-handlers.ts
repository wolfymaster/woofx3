import type { OverlayTokenMintedEvent, OverlayTokenRevokedEvent } from "@woofx3/api/webhooks";
import { EngineEventType } from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { WebhookClient } from "./webhook-client";

// The db proxy publishes overlay token lifecycle events on
// `db.overlay_token.{created,updated}.{appId}`. The CloudEvent's
// `data` carries a snake_cased overlay_token row. We accept both
// camelCase and snake_case defensively — same convention as
// `parseSceneCreated` and `parseWorkflowCreated`.

interface RawOverlayTokenRow {
  ID?: unknown;
  id?: unknown;
  Token?: unknown;
  token?: unknown;
  SceneID?: unknown;
  scene_id?: unknown;
  sceneId?: unknown;
  ApplicationID?: unknown;
  application_id?: unknown;
  applicationId?: unknown;
  Label?: unknown;
  label?: unknown;
  Status?: unknown;
  status?: unknown;
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

function readRow(ce: Record<string, unknown>): RawOverlayTokenRow {
  const data = ce.data;
  if (data && typeof data === "object") {
    return data as RawOverlayTokenRow;
  }
  return ce as RawOverlayTokenRow;
}

/**
 * Derive a non-secret token prefix for operator display ("ovl_abcd").
 * The prefix is the first 8 characters of the token value — never the
 * full plaintext. If the token field is absent from the event (the db
 * outbox should carry it but callers must be robust), return empty string.
 */
function buildTokenPrefix(token: string): string {
  return token.slice(0, 8);
}

/**
 * Initialise NATS subscriptions for overlay token lifecycle events and
 * project them onto webhook callbacks.
 *
 * Subscriptions:
 *   db.overlay_token.created.*  → OVERLAY_TOKEN_MINTED webhook
 *   db.overlay_token.updated.*  → OVERLAY_TOKEN_REVOKED webhook (only when status=revoked)
 *
 * Invariant: the webhook payload NEVER includes the plaintext token.
 * Only `tokenId`, `tokenPrefix`, `sceneId`, `applicationId`, and
 * `label` are forwarded.
 */
export async function initOverlayTokenHandlers(
  nats: NATSClient,
  webhookClient: WebhookClient,
  logger: SharedLogger
): Promise<void> {
  await nats.subscribe("db.overlay_token.created.*", async (msg) => {
    try {
      const ce = JSON.parse(new TextDecoder().decode(msg.data)) as Record<string, unknown>;
      const row = readRow(ce);

      const tokenId = pickFirst(row.ID, row.id);
      const token = pickFirst(row.Token, row.token);
      const sceneId = pickFirst(row.SceneID, row.scene_id, row.sceneId);
      const applicationId = pickFirst(row.ApplicationID, row.application_id, row.applicationId);
      const label = pickFirst(row.Label, row.label);

      if (!tokenId) {
        logger.warn("overlay_token.created: missing id, skipping webhook", { subject: msg.subject });
        return;
      }

      const event: OverlayTokenMintedEvent = {
        type: EngineEventType.OVERLAY_TOKEN_MINTED,
        tokenId,
        sceneId,
        applicationId,
        label,
        // Non-secret prefix only — never the full plaintext token.
        tokenPrefix: buildTokenPrefix(token),
      };

      logger.debug("Emitting OVERLAY_TOKEN_MINTED webhook", { tokenId, sceneId, applicationId });
      await webhookClient.send(event);
    } catch (err) {
      logger.error("overlay_token.created handler error", {
        error: err instanceof Error ? err.message : String(err),
        subject: msg.subject,
      });
    }
  });

  await nats.subscribe("db.overlay_token.updated.*", async (msg) => {
    try {
      const ce = JSON.parse(new TextDecoder().decode(msg.data)) as Record<string, unknown>;
      const row = readRow(ce);

      const status = pickFirst(row.Status, row.status);
      if (status !== "revoked") {
        // Only project revocations; other updates (e.g. lastUsedAt refreshes) are silent.
        return;
      }

      const tokenId = pickFirst(row.ID, row.id);
      const token = pickFirst(row.Token, row.token);
      const sceneId = pickFirst(row.SceneID, row.scene_id, row.sceneId);
      const applicationId = pickFirst(row.ApplicationID, row.application_id, row.applicationId);
      const label = pickFirst(row.Label, row.label);

      if (!tokenId) {
        logger.warn("overlay_token.updated: missing id, skipping webhook", { subject: msg.subject });
        return;
      }

      const event: OverlayTokenRevokedEvent = {
        type: EngineEventType.OVERLAY_TOKEN_REVOKED,
        tokenId,
        sceneId,
        applicationId,
        label,
        // Non-secret prefix only — never the full plaintext token.
        tokenPrefix: buildTokenPrefix(token),
      };

      logger.debug("Emitting OVERLAY_TOKEN_REVOKED webhook", { tokenId, sceneId, applicationId });
      await webhookClient.send(event);
    } catch (err) {
      logger.error("overlay_token.updated handler error", {
        error: err instanceof Error ? err.message : String(err),
        subject: msg.subject,
      });
    }
  });

  logger.info("Overlay token NATS handlers initialized");
}
