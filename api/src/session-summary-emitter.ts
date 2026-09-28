import { EngineEventType, SESSION_SUMMARY_SCHEMA_VERSION, type SessionSummaryEvent } from "@woofx3/api/webhooks";
import { EventType as SessionEventType } from "@woofx3/common/cloudevents/Session/events";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import type { Msg } from "@woofx3/nats/src/types";
import type { DbClient } from "./db-client";
import { readStreamSessionTotals } from "./routes/analytics";
import { readStreamSession } from "./routes/stream-sessions";
import type { WebhookClient } from "./webhook-client";

type SummaryReads = Pick<DbClient, "findStreamSession" | "findStreamSessionEventTotals" | "findStreamGaugeSamples">;

/**
 * The summary of one session as it stands now, or null when the session no
 * longer exists.
 *
 * Built from the same reads as `getStreamSession` and `getStreamSessionTotals`,
 * so a stored summary and a live read of the session describe it identically.
 */
export async function buildSessionSummary(
  db: SummaryReads,
  sessionId: string,
  now: Date = new Date()
): Promise<SessionSummaryEvent | null> {
  const [session, totals] = await Promise.all([
    readStreamSession(db, sessionId),
    readStreamSessionTotals(db, sessionId),
  ]);
  if (session === null || totals === null) {
    return null;
  }
  if (session.id !== totals.sessionId) {
    throw new Error(`session summary mixed session ${session.id} with totals for ${totals.sessionId}`);
  }
  return {
    type: EngineEventType.SESSION_SUMMARY,
    sessionId: session.id,
    schemaVersion: SESSION_SUMMARY_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    session,
    totals: {
      bits: totals.bits,
      cheers: totals.cheers,
      subs: totals.subs,
      giftedSubs: totals.giftedSubs,
      follows: totals.follows,
      raids: totals.raids,
      raiders: totals.raiders,
      peakViewers: totals.peakViewers,
      averageViewers: totals.averageViewers,
      viewerSampleMinutes: totals.viewerSampleMinutes,
    },
  };
}

/**
 * Sends the UI a `SESSION_SUMMARY` for every session that ends.
 *
 * A consumer of `session.ended` like any other, rather than a step inside the
 * resolver: the summary is a read over data the resolver has already written,
 * and a slow or failing read must not hold up the next session being adopted.
 *
 * A summary is a snapshot, so `summarise` can be called again for the same
 * session at any time and the UI keeps the newest.
 */
export class SessionSummaryEmitter {
  constructor(
    private nats: NATSClient,
    private db: SummaryReads,
    private webhook: WebhookClient,
    private logger: SharedLogger
  ) {}

  async start(): Promise<void> {
    await this.nats.subscribe(SessionEventType.SessionEnded, (msg: Msg) => this.handleSessionEnded(msg));
    this.logger.info("SessionSummaryEmitter started", { subject: SessionEventType.SessionEnded });
  }

  /**
   * Build and send one session's summary. Returns false when the session no
   * longer exists, which is not a fault: a merge can remove a session before
   * its summary is built.
   */
  async summarise(sessionId: string): Promise<boolean> {
    const summary = await buildSessionSummary(this.db, sessionId);
    if (summary === null) {
      this.logger.warn("SessionSummaryEmitter: session no longer exists; nothing to summarise", { sessionId });
      return false;
    }
    await this.webhook.send(summary);
    return true;
  }

  private async handleSessionEnded(msg: Msg): Promise<void> {
    const sessionId = readEndedSessionId(msg);
    if (sessionId === null) {
      this.logger.error(`${SessionEventType.SessionEnded}: no sessionId in payload; cannot summarise`, {
        subject: msg.subject,
      });
      return;
    }
    try {
      await this.summarise(sessionId);
    } catch (err) {
      this.logger.error("SessionSummaryEmitter: summarising the ended session failed", {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function readEndedSessionId(msg: Msg): string | null {
  try {
    const ce = msg.json() as Record<string, unknown>;
    const data = (ce.data as Record<string, unknown> | undefined) ?? ce;
    const sessionId = data.sessionId;
    return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  } catch {
    return null;
  }
}
