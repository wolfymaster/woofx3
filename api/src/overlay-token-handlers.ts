import type { OverlayTokenMintedEvent, OverlayTokenRevokedEvent } from "@woofx3/api/webhooks";
import { EngineEventType } from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import { asString, pickFirst, readRow } from "./outbox";
import { subscribeProjections } from "./projection";
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
/**
 * Fields shared by both overlay-token projections.
 *
 * Extracted from the two subscription bodies, which had grown their own
 * inline copies -- this module was the one that had drifted furthest, right
 * down to decoding its payload by hand instead of through `msg.json()`.
 */
function readTokenFields(ce: Record<string, unknown>) {
  const row = readRow<RawOverlayTokenRow>(ce);
  return {
    tokenId: pickFirst(row.ID, row.id),
    token: pickFirst(row.Token, row.token),
    sceneId: pickFirst(row.SceneID, row.scene_id, row.sceneId),
    applicationId: pickFirst(row.ApplicationID, row.application_id, row.applicationId),
    label: pickFirst(row.Label, row.label),
    status: pickFirst(row.Status, row.status),
  };
}

export function parseOverlayTokenMinted(ce: Record<string, unknown>): OverlayTokenMintedEvent | null {
  const { tokenId, token, sceneId, applicationId, label } = readTokenFields(ce);
  if (!tokenId) {
    return null;
  }
  return {
    type: EngineEventType.OVERLAY_TOKEN_MINTED,
    tokenId,
    sceneId,
    applicationId,
    label,
    // Non-secret prefix only -- never the full plaintext token.
    tokenPrefix: buildTokenPrefix(token),
  };
}

export function parseOverlayTokenRevoked(ce: Record<string, unknown>): OverlayTokenRevokedEvent | null {
  const { tokenId, token, sceneId, applicationId, label } = readTokenFields(ce);
  if (!tokenId) {
    return null;
  }
  return {
    type: EngineEventType.OVERLAY_TOKEN_REVOKED,
    tokenId,
    sceneId,
    applicationId,
    label,
    tokenPrefix: buildTokenPrefix(token),
  };
}

export async function initOverlayTokenHandlers(
  nats: NATSClient,
  webhookClient: WebhookClient,
  logger: SharedLogger
): Promise<void> {
  await subscribeProjections({ nats, webhookClient, logger }, [
    {
      subject: "db.overlay_token.created.*",
      name: "db.overlay_token.created",
      parse: (ce) => {
        const event = parseOverlayTokenMinted(ce);
        return event ? { event } : null;
      },
      context: (event) => ({ tokenId: (event as OverlayTokenMintedEvent).tokenId }),
    },
    {
      subject: "db.overlay_token.updated.*",
      name: "db.overlay_token.updated",
      // Updates fire on lastUsedAt refreshes too; only revocations project.
      interested: (ce) => readTokenFields(ce).status === "revoked",
      parse: (ce) => {
        const event = parseOverlayTokenRevoked(ce);
        return event ? { event } : null;
      },
      context: (event) => ({ tokenId: (event as OverlayTokenRevokedEvent).tokenId }),
    },
  ]);
}
