import type { ObsSceneListing } from "@woofx3/api";
import type { ObsControlCommand, ObsControlReply } from "@woofx3/common/cloudevents/Obs/commands";
import { EventType } from "@woofx3/common/cloudevents/Obs/commands";
import { routeModule } from "./context";

/**
 * How long a listing waits on the scene manager. Short, because a person is
 * waiting on a dropdown; OBS answers a local listing well inside it.
 */
export const OBS_LIST_TIMEOUT_MS = 5_000;

export const obsRoutes = routeModule({
  /**
   * Ask the scene manager for OBS's scenes over the same `engine.obs.command`
   * request the workflow `obs.*` actions use, so the listing sees exactly the
   * OBS connection those actions will act through.
   *
   * Every failure is a listing marked unavailable rather than a throw: a
   * picker with no OBS behind it should say why and fall back to typing a
   * name, not break the form it sits in.
   */
  async listObsScenes(): Promise<ObsSceneListing> {
    if (!this.nats) {
      return { available: false, reason: "the message bus is not connected" };
    }
    const command: ObsControlCommand = { command: "list_scenes" };
    const request = new TextEncoder().encode(
      JSON.stringify({
        specversion: "1.0",
        id: crypto.randomUUID(),
        type: EventType.ObsCommand,
        source: "api",
        time: new Date().toISOString(),
        datacontenttype: "application/json",
        data: command,
      })
    );

    let reply: ObsControlReply;
    try {
      const response = await this.nats.request(EventType.ObsCommand, request, { timeout: OBS_LIST_TIMEOUT_MS });
      reply = JSON.parse(new TextDecoder().decode(response.data)) as ObsControlReply;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn("listObsScenes: no answer from the scene manager", { error: message });
      return { available: false, reason: `the scene manager did not answer: ${message}` };
    }

    if (!reply.ok) {
      return { available: false, reason: reply.error };
    }
    return { available: true, scenes: reply.scenes ?? [] };
  },
});
