import type { SharedLogger } from "@woofx3/common/logging";
import { getStreamStatus, type StreamStatus } from "../twitch-stream-status";
import { routeModule } from "./context";

export const accountsRoutes = routeModule({
  async getStreamStatus(): Promise<StreamStatus> {
    return getStreamStatus(this.db, this.logger as SharedLogger);
  },
});
