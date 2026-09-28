import type { AdSchedule, AdSnoozeResult } from "@woofx3/api";
import { fetchAdSchedule, requestAdSnooze } from "../twitch-ads";
import { routeModule } from "./context";

export const twitchAdsRoutes = routeModule({
  async getAdSchedule(): Promise<AdSchedule> {
    if (!this.nats) {
      throw new Error("NATS client not available");
    }
    return fetchAdSchedule(this.nats);
  },

  async snoozeNextAd(): Promise<AdSnoozeResult> {
    if (!this.nats) {
      throw new Error("NATS client not available");
    }
    const result = await requestAdSnooze(this.nats);
    this.logger.info("snoozeNextAd", { snoozeCount: result.snoozeCount, nextAdAt: result.nextAdAt });
    return result;
  },
});
