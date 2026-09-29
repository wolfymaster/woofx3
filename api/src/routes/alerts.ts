import type { AlertClearResult, AlertReplayResult, AlertSkipResult } from "@woofx3/api";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import { routeModule } from "./context";

/**
 * Short enough that an operator pressing Skip mid-raid hears back while the
 * raid is still on.
 */
const ALERT_QUEUE_TIMEOUT_MS = 5_000;

/**
 * A replay makes several db round trips before it answers. The scene manager
 * answers a repeated replay of the same alert within 30 s with the first one's
 * result (REPLAY_DEDUPE_MS in sceneManager/src/events/alert-controls.ts), and
 * this must stay below that so a retry after a timeout cannot play it twice.
 */
const ALERT_REPLAY_TIMEOUT_MS = 15_000;

/**
 * Carry one alert queue control to the scene manager and return its answer.
 *
 * The queues live in the overlays the scene manager streams to, so it is the
 * one that answers. One that does not answer is returned as a refusal rather
 * than thrown, so the caller can tell the operator why nothing happened.
 */
async function requestAlertControl<T extends { ok: boolean; reason?: string }>(
  nats: NATSClient | null,
  logger: SharedLogger,
  subject: string,
  body: Record<string, unknown>,
  unanswered: T,
  timeout: number
): Promise<T> {
  if (!nats) {
    throw new Error("NATS client not available");
  }
  let data: Uint8Array;
  try {
    const reply = await nats.request(subject, new TextEncoder().encode(JSON.stringify(body)), {
      timeout,
    });
    data = reply.data;
  } catch (err) {
    const reason = `the scene manager did not answer: ${err instanceof Error ? err.message : String(err)}`;
    logger.warn("alert control unanswered", { subject, reason });
    return { ...unanswered, reason };
  }
  return JSON.parse(new TextDecoder().decode(data)) as T;
}

export const alertsRoutes = routeModule({
  async replayAlert(id: string): Promise<AlertReplayResult> {
    if (!id) {
      throw new Error("alert id is required");
    }
    const result = await requestAlertControl<AlertReplayResult>(
      this.nats,
      this.logger,
      "widget.queue.replay",
      { id },
      { ok: false },
      ALERT_REPLAY_TIMEOUT_MS
    );
    if (!result.ok) {
      this.logger.warn("Replay refused", { id, reason: result.reason });
      return result;
    }
    this.logger.info("Alert replayed", { id, replayEnvelopeId: result.replayEnvelopeId });
    return result;
  },

  async skipCurrentAlert(): Promise<AlertSkipResult> {
    const result = await requestAlertControl<AlertSkipResult>(
      this.nats,
      this.logger,
      "widget.queue.skip",
      {},
      { ok: false, skipped: 0 },
      ALERT_QUEUE_TIMEOUT_MS
    );
    this.logger.info("skipCurrentAlert", { ok: result.ok, skipped: result.skipped, reason: result.reason });
    return result;
  },

  async clearAlertQueue(): Promise<AlertClearResult> {
    const result = await requestAlertControl<AlertClearResult>(
      this.nats,
      this.logger,
      "widget.queue.clear",
      {},
      { ok: false, cleared: 0 },
      ALERT_QUEUE_TIMEOUT_MS
    );
    this.logger.info("clearAlertQueue", { ok: result.ok, cleared: result.cleared, reason: result.reason });
    return result;
  },
});
