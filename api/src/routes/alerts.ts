import { routeModule } from "./context";
export const alertsRoutes = routeModule({
  async replayAlert(id: string): Promise<boolean> {
    if (!this.nats) {
      throw new Error("NATS client not available");
    }
    if (!id) {
      throw new Error("alert id is required");
    }
    this.logger.info("Replaying alert (forwarding to streamware)", { id });
    const reply = await this.nats.request("widget.queue.replay", new TextEncoder().encode(JSON.stringify({ id })));
    const result = JSON.parse(new TextDecoder().decode(reply.data)) as {
      ok: boolean;
      message: string;
      replayEnvelopeId?: string;
    };
    if (!result.ok) {
      this.logger.warn("Replay rejected", { id, reason: result.message });
      return false;
    }
    this.logger.info("Alert replayed", { id, replayEnvelopeId: result.replayEnvelopeId });
    return true;
  },

  /**
   * Forward a "skip the current alert" RPC to streamware's queue
   * manager. The orchestrator marks the in-flight alert `skipped`,
   * dispatches the next pending, and the standard
   * `db.alert.updated.*` outbox event drives the ALERT_SKIPPED
   * webhook from the api boundary.
   */
  async skipCurrentAlert(): Promise<{ skipped: boolean }> {
    if (!this.nats) {
      throw new Error("NATS client not available");
    }
    const appId = await this.ensureApplicationId();
    const reply = await this.nats.request(
      "widget.queue.skip",
      new TextEncoder().encode(JSON.stringify({ applicationId: appId }))
    );
    const result = JSON.parse(new TextDecoder().decode(reply.data)) as { skipped: boolean };
    this.logger.info("skipCurrentAlert", { applicationId: appId, skipped: result.skipped });
    return result;
  },

  /**
   * Forward a "clear pending" RPC to streamware. The orchestrator
   * marks every pending alert `skipped` (without touching the
   * in-flight lease) and returns the count.
   */
  async clearAlertQueue(): Promise<{ cleared: number }> {
    if (!this.nats) {
      throw new Error("NATS client not available");
    }
    const appId = await this.ensureApplicationId();
    const reply = await this.nats.request(
      "widget.queue.clear",
      new TextEncoder().encode(JSON.stringify({ applicationId: appId }))
    );
    const result = JSON.parse(new TextDecoder().decode(reply.data)) as { cleared: number };
    this.logger.info("clearAlertQueue", { applicationId: appId, cleared: result.cleared });
    return result;
  },
});
