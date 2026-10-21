import { testEventProblem } from "../workflow/reserved-subjects";
import { routeModule } from "./context";
export const eventsRoutes = routeModule({
  async simulateTwitchEvent(
    eventType: string,
    eventData: Record<string, unknown>,
    triggerId?: string,
    triggeredBy?: string
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    const problem = testEventProblem("simulate", eventType);
    if (problem !== null) {
      throw new Error(`Cannot simulate event ${JSON.stringify(eventType)}: it ${problem}`);
    }
    // Published verbatim, with the platform stamped: a simulated event has to
    // be byte-identical to a real one or it exercises a path real events do
    // not take. `eventType` is the registered trigger's event -- e.g.
    // `channel.follow`.
    this.logger.info("Simulating Twitch event", { eventType, triggerId });
    await this.publishEvent(eventType, eventData, eventType, "twitch", "api", { triggerId, triggeredBy });

    this.logger.info("Twitch event simulated successfully", { eventType, subject: eventType });
    return {
      success: true,
      message: `Simulated Twitch event: ${eventType}`,
    };
  },

  /**
   * Trigger a workflow by publishing an event.
   * Useful for triggering workflows that listen to specific event types.
   */
  async triggerEvent(
    eventType: string,
    eventData: Record<string, unknown>,
    triggerId?: string,
    triggeredBy?: string
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    const problem = testEventProblem("trigger", eventType);
    if (problem !== null) {
      throw new Error(`Cannot trigger event ${JSON.stringify(eventType)}: it ${problem}`);
    }
    await this.publishEvent(eventType, eventData, undefined, undefined, "api", { triggerId, triggeredBy });

    return {
      success: true,
      message: `Published event: ${eventType}`,
    };
  },
});
