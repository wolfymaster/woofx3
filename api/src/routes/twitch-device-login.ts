import type { TwitchDeviceLoginStartResult, TwitchDeviceLoginStateResult } from "@woofx3/api";
import { routeModule } from "./context";

/** Linking Twitch from the engine with a device login; the logins themselves are `TwitchDeviceLogins`. */
export const twitchDeviceLoginRoutes = routeModule({
  async startTwitchDeviceLogin(scopes?: string[]): Promise<TwitchDeviceLoginStartResult> {
    return this.twitchDeviceLogins.start(scopes);
  },

  async getTwitchDeviceLogin(loginId: string): Promise<TwitchDeviceLoginStateResult> {
    return this.twitchDeviceLogins.get(loginId);
  },

  async cancelTwitchDeviceLogin(loginId: string): Promise<{ cancelled: boolean }> {
    return this.twitchDeviceLogins.cancel(loginId);
  },
});
