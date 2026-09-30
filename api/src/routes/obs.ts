import type { ObsStatus } from "@woofx3/api";
import { OBS_STATUS_SUBJECT } from "@woofx3/common/cloudevents/Obs/commands";
import { routeModule } from "./context";

/** Short: the answer is in memory, and the page asking is waiting on it. */
const OBS_STATUS_TIMEOUT_MS = 3_000;

const OBS_CONNECTION_STATES = new Set(["connecting", "connected", "retrying", "stopped"]);
const OBS_FAILURES = new Set(["authentication", "unreachable"]);

/**
 * The scene manager's reply as an ObsStatus. Anything malformed reads as
 * unanswered: a status that cannot be trusted must not look like a real one.
 */
export function parseObsStatusReply(raw: unknown): ObsStatus {
  const reply = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const state = typeof reply.state === "string" && OBS_CONNECTION_STATES.has(reply.state) ? reply.state : null;
  if (state === null) {
    return { state: "unanswered", failure: null, address: null };
  }
  return {
    state: state as ObsStatus["state"],
    failure:
      typeof reply.failure === "string" && OBS_FAILURES.has(reply.failure)
        ? (reply.failure as ObsStatus["failure"])
        : null,
    address: typeof reply.address === "string" && reply.address.length > 0 ? reply.address : null,
  };
}

export const obsRoutes = routeModule({
  async getObsStatus(): Promise<ObsStatus> {
    if (!this.nats) {
      return { state: "unanswered", failure: null, address: null };
    }
    try {
      const reply = await this.nats.request(OBS_STATUS_SUBJECT, new TextEncoder().encode("{}"), {
        timeout: OBS_STATUS_TIMEOUT_MS,
      });
      return parseObsStatusReply(JSON.parse(new TextDecoder().decode(reply.data)));
    } catch (err) {
      this.logger.warn("getObsStatus: the scene manager did not answer", {
        error: err instanceof Error ? err.message : String(err),
      });
      return { state: "unanswered", failure: null, address: null };
    }
  },
});
