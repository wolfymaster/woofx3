import type { StreamEventSubscriber } from "@woofx3/api";
import { routeModule } from "./context";

export const streamEventsRoutes = routeModule({
  /**
   * Subscribe to live stream events for the session's lifetime.
   *
   * Throws rather than accepting a subscription it cannot serve: without NATS
   * the engine receives no events at all, and silently registering a callback
   * that never fires looks identical to a quiet stream.
   */
  async subscribeStreamEvents(callback: StreamEventSubscriber): Promise<void> {
    if (!this.streamEventBroadcaster) {
      throw new Error("Stream events are unavailable: the engine has no NATS connection");
    }
    this.streamEventBroadcaster.subscribe(callback);
  },
});
