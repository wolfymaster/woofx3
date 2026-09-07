import { routeModule } from "./context";
export const eventsRoutes = routeModule({
  async simulateTwitchEvent(
    eventType: string,
    eventData: Record<string, unknown>
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    this.logger.info("Simulating Twitch event", { eventType, eventData });
    const subject = `twitch.${eventType}`;
    await this.publishEvent(`twitch.${eventType}`, eventData, subject);

    this.logger.info("Twitch event simulated successfully", { eventType, subject });
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
  }
});
