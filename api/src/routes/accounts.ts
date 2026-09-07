import type { SharedLogger } from "@woofx3/common/logging";
import { getStreamStatus, type StreamStatus } from "../twitch-stream-status";
import { routeModule } from "./context";

export const accountsRoutes = routeModule({
  /**
   * `accountId` is accepted for backward compatibility with the legacy mock
   * signature but is unused -- the engine is single-broadcaster-per-deployment,
   * so the bootstrapped Twitch user is the only one to query.
   */
  async getStreamStatus(_accountId: string): Promise<StreamStatus> {
    return getStreamStatus(this.db, this.logger as SharedLogger);
  },
});
