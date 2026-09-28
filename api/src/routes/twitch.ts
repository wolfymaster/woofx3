import type {
  TwitchCategory,
  TwitchStreamInfo,
  TwitchStreamMarker,
  UpdateStreamInfoInput,
  UpdateStreamInfoResult,
} from "@woofx3/api";
import type NATSClient from "@woofx3/nats/src/client";
import { routeModule } from "./context";

/** The subject the twitch service answers on; see twitch/src/application.ts. */
const TWITCHAPI_SUBJECT = "twitchapi";
/** The reply type the twitch service answers a refused request with. */
const TWITCHAPI_ERROR_TYPE = "twitchapi.error";
const TWITCHAPI_TIMEOUT_MS = 10_000;

/**
 * Run one command on the twitch service and return its result. Validation
 * and every Twitch rule live there, so a refusal comes back as that
 * service's own message rather than a second, drifting copy of the rules.
 */
export async function requestTwitchApi<T>(nats: NATSClient | null, command: string, args: object): Promise<T> {
  if (!nats) {
    throw new Error("NATS client not available");
  }
  const envelope = {
    id: crypto.randomUUID(),
    type: TWITCHAPI_SUBJECT,
    source: "api",
    time: new Date().toISOString(),
    data: { command, args },
  };
  let reply: { data: Uint8Array };
  try {
    reply = await nats.request(TWITCHAPI_SUBJECT, new TextEncoder().encode(JSON.stringify(envelope)), {
      timeout: TWITCHAPI_TIMEOUT_MS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("no responders")) {
      throw new Error("The Twitch service is not running");
    }
    throw err;
  }
  const body = JSON.parse(new TextDecoder().decode(reply.data)) as { type?: string; data?: unknown };
  if (body.type === TWITCHAPI_ERROR_TYPE) {
    const error = (body.data as { error?: unknown } | undefined)?.error;
    throw new Error(typeof error === "string" ? error : `twitchapi ${command} failed`);
  }
  return body.data as T;
}

export const twitchRoutes = routeModule({
  async getStreamInfo(): Promise<TwitchStreamInfo> {
    return requestTwitchApi<TwitchStreamInfo>(this.nats, "getStreamInfo", {});
  },

  async updateStreamInfo(input: UpdateStreamInfoInput): Promise<UpdateStreamInfoResult> {
    return requestTwitchApi<UpdateStreamInfoResult>(this.nats, "updateStream", input ?? {});
  },

  async createStreamMarker(input?: { description?: string }): Promise<TwitchStreamMarker> {
    return requestTwitchApi<TwitchStreamMarker>(this.nats, "createMarker", input ?? {});
  },

  async searchTwitchCategories(input: { query: string; first?: number }): Promise<TwitchCategory[]> {
    return requestTwitchApi<TwitchCategory[]>(this.nats, "searchCategories", input ?? {});
  },
});
