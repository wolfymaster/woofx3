import type { CallbackEvent } from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { WebhookClient } from "./webhook-client";

/**
 * A parsed outbox row, ready to leave as a webhook.
 *
 * `clientId` routes the webhook at one registered client -- the module
 * projections carry it so an install initiated by a particular client is
 * reported back to that client. Omitting it fans out to every client.
 */
export interface ParsedProjection {
  event: CallbackEvent;
  clientId?: string;
}

/**
 * One db-proxy outbox subject projected onto a webhook.
 *
 * `parse` returns null when the row is missing something required, which is
 * a drop rather than an error: the outbox is at-least-once and rows from
 * older schema versions still arrive.
 */
export interface Projection {
  /** NATS subject, e.g. "db.scene.created.*". */
  subject: string;
  /** Used in logs. Conventionally the subject without the `db.` or wildcard. */
  name: string;
  /**
   * Whether this row is for this projection at all.
   *
   * Distinct from a null parse. Overlay-token updates fire on every
   * lastUsedAt refresh but only revocations are projected, and skipping
   * those is routine rather than a dropped row -- keeping the two apart
   * means a genuinely malformed row still warns.
   */
  interested?(ce: Record<string, unknown>): boolean;
  parse(ce: Record<string, unknown>): ParsedProjection | null;
  /** Extra log context on a successful dispatch. */
  context?(event: CallbackEvent): Record<string, unknown>;
  /**
   * Set when a null parse is a normal outcome rather than a malformed row --
   * alert lifecycle transitions with no webhook surface drop here on every
   * playback. Those are logged at debug so the expected case does not read
   * as a warning.
   */
  quietDrop?: boolean;
}

export interface ProjectionDeps {
  nats: NATSClient;
  webhookClient: WebhookClient;
  logger: SharedLogger;
}

/**
 * Subscribe a set of projections.
 *
 * Every one of the twenty-five subscriptions in this service used to spell
 * out the same nine lines: read the CloudEvent, parse it, drop it if the
 * parse failed, send the webhook, and swallow anything thrown so one bad row
 * cannot take down the subscription. Writing it once means a change to any of
 * that -- error handling, delivery, logging -- happens in one place rather
 * than twenty-five.
 *
 * It also removes the room for drift that produced the one subscription
 * decoding its payload with a hand-rolled TextDecoder while the rest used
 * `msg.json()`.
 *
 * The `parse` functions are deliberately untouched by this. They hold the
 * real knowledge about each row shape, they are the best-tested code in the
 * service, and they stay exactly where they are.
 */
export async function subscribeProjections(deps: ProjectionDeps, projections: Projection[]): Promise<void> {
  const { nats, webhookClient, logger } = deps;

  for (const projection of projections) {
    await nats.subscribe(projection.subject, async (msg) => {
      try {
        const ce = msg.json() as Record<string, unknown>;
        if (projection.interested !== undefined && !projection.interested(ce)) {
          return;
        }
        const parsed = projection.parse(ce);
        if (!parsed) {
          if (projection.quietDrop === true) {
            logger.debug(`${projection.name}: no webhook surface for this row; dropping`);
          } else {
            logger.warn(`${projection.name}: missing required fields; dropping`);
          }
          return;
        }
        await webhookClient.send(parsed.event, parsed.clientId || undefined);
        logger.info(`${projection.name} webhook dispatched`, projection.context?.(parsed.event));
      } catch (err) {
        // A failed row must not take the subscription down with it: NATS
        // would stop delivering the rest of the subject.
        logger.error(`${projection.name}: handler failed`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  logger.info("NATS projections initialized", { count: projections.length });
}
