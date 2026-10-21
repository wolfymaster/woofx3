import type { EngineEventSubscribeOptions, EngineEventSubscriber, EngineRequestAnswer } from "@woofx3/api";
import { EngineEventType } from "@woofx3/api/webhooks";
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
});

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
