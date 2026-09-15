import { routeModule } from "./context";
export const eventsRoutes = routeModule({
  async simulateTwitchEvent(
    eventType: string,
    eventData: Record<string, unknown>
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    // Published verbatim, with the platform stamped: a simulated event has to
    // be byte-identical to a real one or it exercises a path real events do
    // not take. `eventType` is the registered trigger's event -- e.g.
    // `channel.follow` -- not a Twitch-prefixed name. The old `twitch.` prefix
    // matched no registered trigger in any vocabulary this engine has had.
    this.logger.info("Simulating Twitch event", { eventType, eventData });
    await this.publishEvent(eventType, eventData, eventType, "twitch");

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
    eventData: Record<string, unknown>
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    await this.publishEvent(eventType, eventData);

    return {
      success: true,
      message: `Published event: ${eventType}`,
    };
  },
});
