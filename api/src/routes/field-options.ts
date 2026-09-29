import { routeModule } from "./context";
import type { FieldOptionsReference } from "@woofx3/api";
import { EngineEventType } from "@woofx3/api/webhooks";
import { fieldOptionsDescriptorFor, parseFieldOptionsReference, parseStoredManifest } from "../field-options-reference";

/**
 * The reason a worker gave for not listing options, when its reply is the
 * field-options failure shape `{ error: string }` (what `twitchapi` answers
 * with, and what a module's field-options function returns when it cannot
 * list, such as OBS not being connected), else null. Relayed as a failed
 * request so the UI can say why a picker is empty rather than showing no
 * options at all.
 */
export function fieldOptionsReplyError(data: unknown): string | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const error = (data as { error?: unknown }).error;
  return typeof error === "string" && error !== "" ? error : null;
}

export const fieldOptionsRoutes = routeModule({
  /**
   * Send the request an installed module declares for one of its fields, and
   * relay the reply to the caller's webhook under `correlationKey`.
   *
   * The caller names the field, never the request: the subject and payload
   * come from the stored manifest, so a signed-in client can only trigger a
   * request some installed module declared, not an arbitrary one on any
   * subject.
   */
  async dispatchFieldOptionsRequest(
    reference: FieldOptionsReference,
    correlationKey: string
  ): Promise<{ dispatched: boolean }> {
    if (!this.nats) {
      throw new Error("NATS client not available");
    }
    if (typeof correlationKey !== "string" || correlationKey === "") {
      throw new Error("dispatchFieldOptionsRequest: correlationKey is required");
    }
    const parsed = parseFieldOptionsReference(reference);
    const installed = await this.db.findModuleByModuleId(parsed.moduleId);
    const manifest = installed ? parseStoredManifest(installed.manifest) : null;
    if (installed === null || manifest === null) {
      throw new Error(`dispatchFieldOptionsRequest: module "${parsed.moduleId}" is not installed`);
    }
    if (installed.state === "disabled") {
      throw new Error(
        `dispatchFieldOptionsRequest: module "${parsed.moduleId}" is disabled; enable it to use its field requests`
      );
    }
    const descriptor = fieldOptionsDescriptorFor(manifest, parsed);

    const eventId = crypto.randomUUID();
    const requestEnvelope = {
      id: eventId,
      type: descriptor.request.event,
      source: "api",
      time: new Date().toISOString(),
      data: descriptor.request.payload ?? {},
    };
    const requestBytes = new TextEncoder().encode(JSON.stringify(requestEnvelope));
    const timeout = descriptor.timeoutMs ?? 10_000;
    const nats = this.nats;

    this.logger.info("dispatchFieldOptionsRequest dispatching", {
      correlationKey,
      subject: descriptor.request.event,
      payload: descriptor.request.payload,
      timeoutMs: timeout,
    });

    // `no responders` is NATS's immediate "zero subscribers on this
    // subject right now" reply — common in dev when a worker is still
    // booting (Twurple + EventSub setup, etc.) at the moment the user
    // opens a dropdown. Retry on `no responders` only — other errors
    // (timeout from a slow handler, malformed reply, etc.) propagate
    // immediately so we don't paper over real bugs.
    const requestWithBootRetry = async (): Promise<{ data: Uint8Array }> => {
      const backoffsMs = [250, 500, 1000, 2000];
      let lastError: unknown;
      for (let attempt = 0; attempt <= backoffsMs.length; attempt++) {
        try {
          return await nats.request(descriptor.request.event, requestBytes, { timeout });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.includes("no responders")) {
            throw err;
          }
          lastError = err;
          if (attempt === backoffsMs.length) {
            break;
          }
          const delay = backoffsMs[attempt];
          this.logger.info("dispatchFieldOptionsRequest no responders, retrying", {
            correlationKey,
            subject: descriptor.request.event,
            attempt: attempt + 1,
            nextDelayMs: delay,
          });
          await new Promise((r) => setTimeout(r, delay));
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    };

    // Fire-and-forget: kick off the request, route the reply (or error)
    // through the webhook back to Convex without holding this RPC open.
    requestWithBootRetry()
      .then(async (reply) => {
        const text = new TextDecoder().decode(reply.data);
        let data: unknown;
        try {
          const parsed = JSON.parse(text);
          // Workers may reply with a CloudEvent envelope ({type, data, ...})
          // or raw data. Prefer envelope.data when present.
          data = parsed && typeof parsed === "object" && "data" in parsed ? (parsed as { data: unknown }).data : parsed;
        } catch {
          data = text;
        }

        // Result-shape summary mirrors the twitch worker side so the
        // request and response sides line up in the logs. An empty array
        // here usually means the worker ran fine and just returned []
        // (e.g. broadcaster has no manageable rewards) — distinct from
        // the .catch path which means the request never got a reply.
        let dataSummary: string;
        if (Array.isArray(data)) {
          dataSummary = `array(len=${data.length})${
            data.length > 0 ? ` first=${JSON.stringify(data[0]).slice(0, 200)}` : ""
          }`;
        } else if (data === null || data === undefined) {
          dataSummary = String(data);
        } else if (typeof data === "object") {
          dataSummary = `object keys=[${Object.keys(data as Record<string, unknown>).join(", ")}]`;
        } else {
          dataSummary = `${typeof data} ${JSON.stringify(data).slice(0, 200)}`;
        }
        this.logger.info("dispatchFieldOptionsRequest reply received", {
          correlationKey,
          subject: descriptor.request.event,
          dataSummary,
          willForward: !!this.webhookClient,
        });

        if (this.webhookClient) {
          const error = fieldOptionsReplyError(data);
          await this.webhookClient.send(
            error === null
              ? { type: EngineEventType.ENGINE_RESPONSE_RECEIVED, correlationKey, status: "success", data }
              : { type: EngineEventType.ENGINE_RESPONSE_RECEIVED, correlationKey, status: "error", error }
          );
        }
      })
      .catch(async (err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn("dispatchFieldOptionsRequest reply failed", {
          correlationKey,
          subject: descriptor.request.event,
          error: message,
        });
        if (this.webhookClient) {
          await this.webhookClient.send({
            type: EngineEventType.ENGINE_RESPONSE_RECEIVED,
            correlationKey,
            status: "error",
            error: message,
          });
        }
      });

    return { dispatched: true };
  },
});
