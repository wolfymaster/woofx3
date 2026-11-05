import type {
  EngineEventSubscribeOptions,
  EngineEventSubscriber,
  EngineRequestAnswer,
  EventsTarget,
} from "@woofx3/api";
import { EngineEventType } from "@woofx3/api/webhooks";
import { callbackUrlRefusal } from "../webhook-client";
import { routeModule } from "./context";

export const engineEventsRoutes = routeModule({
  /**
   * Subscribe the session's client to its engine events and requests.
   * `ApiSession` passes itself and its client id as `context`, so a client's
   * later call replaces its earlier one, and what it receives is what its
   * callback URL would be sent.
   */
  async subscribeEngineEvents(
    callback: EngineEventSubscriber,
    options: EngineEventSubscribeOptions | undefined,
    context: { session: object; clientId: string }
  ): Promise<void> {
    if (!this.engineEventStream) {
      throw new Error("The engine event stream is unavailable");
    }
    const types = options?.types === undefined ? undefined : readTypes(options.types);
    this.engineEventStream.subscribe(callback, types, context.session, context.clientId);
  },

  async answerEngineRequest(
    requestId: string,
    answer: EngineRequestAnswer,
    context: { clientId: string }
  ): Promise<void> {
    if (!this.engineEventStream) {
      throw new Error("The engine event stream is unavailable");
    }
    if (typeof requestId !== "string" || requestId === "") {
      throw new Error("requestId must be a non-empty string");
    }
    this.engineEventStream.answer(context.clientId, requestId, readAnswer(answer));
  },

  /**
   * Point the session's client's events at `target`, or back at its callback
   * URL (null). Stored by db-proxy, then picked up by the webhook client at
   * once, so the next event already goes the new way.
   */
  async setEventsTarget(target: EventsTarget | null, context: { clientId: string }): Promise<{ ok: true }> {
    if (!this.webhookClient) {
      throw new Error("The webhook client is unavailable");
    }
    const parsed = readEventsTarget(target);
    const found = await this.db.getClientByClientID(context.clientId);
    if (found.status?.code !== "OK" || !found.client) {
      throw new Error(`setEventsTarget: client ${context.clientId} not found`);
    }
    const set = await this.db.setClientEventsTarget({
      id: found.client.id,
      eventsUrl: parsed?.url ?? "",
      eventsToken: parsed?.token ?? "",
    });
    if (set.status?.code !== "OK") {
      throw new Error(`setEventsTarget: db-proxy answered ${set.status?.code}: ${set.status?.message ?? ""}`);
    }
    await this.webhookClient.refreshCallbackUrls();
    this.logger.info(parsed ? "Events target set" : "Events target cleared", {
      clientId: context.clientId,
      url: parsed?.url,
    });
    return { ok: true };
  },
});

/** The target as the contract types it, refusing anything else: it arrives from a client. */
function readEventsTarget(target: unknown): EventsTarget | null {
  if (target === null) {
    return null;
  }
  if (typeof target !== "object") {
    throw new Error("target must be { url, token } or null");
  }
  const { url, token } = target as { url?: unknown; token?: unknown };
  if (typeof url !== "string" || typeof token !== "string" || token === "") {
    throw new Error("target must be { url, token } with a non-empty token, or null");
  }
  const refusal = callbackUrlRefusal(url);
  if (refusal !== null) {
    throw new Error(`The events URL is refused: ${refusal}.`);
  }
  return { url, token };
}

const ENGINE_EVENT_TYPES: ReadonlySet<string> = new Set(Object.values(EngineEventType));

/**
 * The types filter, refusing any value that is not an `EngineEventType`: a
 * misspelt type would otherwise match nothing, and filter silently forever.
 */
function readTypes(types: unknown): EngineEventType[] {
  if (!Array.isArray(types)) {
    throw new Error("types must be a list of engine event types");
  }
  for (const type of types) {
    if (typeof type !== "string" || !ENGINE_EVENT_TYPES.has(type)) {
      throw new Error(`types: ${JSON.stringify(type)} is not an engine event type`);
    }
  }
  return types as EngineEventType[];
}

/** The answer as the contract types it, refusing anything else: it arrives from a client. */
function readAnswer(answer: unknown): EngineRequestAnswer {
  if (typeof answer !== "object" || answer === null || !("ok" in answer)) {
    throw new Error("answer must be { ok: true, body } or { ok: false, error }");
  }
  const { ok } = answer as { ok: unknown };
  if (ok === true) {
    return { ok: true, body: (answer as { body?: unknown }).body };
  }
  const { error } = answer as { error?: unknown };
  if (ok === false && typeof error === "string") {
    return { ok: false, error };
  }
  throw new Error("answer must be { ok: true, body } or { ok: false, error }");
}
