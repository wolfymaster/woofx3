import type { InboundWebhookRequest, InboundWebhookResponse } from "@woofx3/api";
import { InvokeTimeoutError } from "@woofx3/barkloader";
import { validateWebhookHandlerResult } from "../inbound-webhook-result";
import { routeModule } from "./context";

const WEBHOOK_TRANSPORT = "webhook";
const EVENTBUS_TRANSPORT = "eventbus";

function emptyResponse(status: number): InboundWebhookResponse {
  return { status, headers: {}, body: "" };
}

/** `{moduleId}:trigger:{triggerId}` split into its two ids, or null. */
function parseTriggerId(triggerId: string): { moduleId: string; manifestId: string } | null {
  const [moduleId, kind, manifestId, ...rest] = triggerId.split(":");
  if (!moduleId || kind !== "trigger" || !manifestId || rest.length > 0) {
    return null;
  }
  return { moduleId, manifestId };
}

function parseJsonBody(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

export const inboundWebhooksRoutes = routeModule({
  /**
   * Run a module's webhook handler on an inbound HTTP request the control
   * plane relayed, publish the events it returns, and hand back its response.
   *
   * The handler never publishes anything itself: it returns events, and the
   * engine checks and publishes them, so a 2xx reaches the provider only
   * once every event is on the bus. Nothing is published when the handler
   * throws or returns anything invalid.
   */
  async handleInboundWebhook(triggerId: string, request: InboundWebhookRequest): Promise<InboundWebhookResponse> {
    const startedAt = Date.now();
    // Headers and bodies carry signatures and customer data, so the log line
    // names the delivery and its outcome only.
    const finish = (response: InboundWebhookResponse, reason?: string): InboundWebhookResponse => {
      this.logger.info("Inbound webhook handled", {
        deliveryId: request.deliveryId,
        triggerId,
        status: response.status,
        durationMs: Date.now() - startedAt,
        ...(reason ? { reason } : {}),
      });
      return response;
    };

    const ids = parseTriggerId(triggerId);
    if (!ids) {
      return finish(emptyResponse(404), "malformed trigger id");
    }
    // Active rows only: an archived webhook trigger must stop answering.
    const moduleTriggers = await this.db.listTriggers("MODULE", ids.moduleId);
    const webhook = moduleTriggers.find(
      (t) => t.manifestId === ids.manifestId && t.transport === WEBHOOK_TRANSPORT && t.handler !== ""
    );
    if (!webhook) {
      return finish(emptyResponse(404), "no active webhook trigger");
    }
    const functions = this.functions;
    if (!functions || !functions.isConnected()) {
      return finish(emptyResponse(503), "barkloader is not connected");
    }

    let result: unknown;
    try {
      result = await functions.invoke(webhook.handler, {
        id: request.deliveryId,
        type: webhook.event,
        source: "api",
        time: new Date().toISOString(),
        data: {
          method: request.method,
          headers: request.headers,
          query: request.query,
          body: parseJsonBody(request.rawBody),
          rawBody: request.rawBody,
        },
      });
    } catch (err) {
      if (err instanceof InvokeTimeoutError) {
        return finish(emptyResponse(504), "handler timed out");
      }
      if (!functions.isConnected()) {
        return finish(emptyResponse(503), "barkloader disconnected mid-request");
      }
      return finish(emptyResponse(500), `handler failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const allowedEventTypes = new Set(
      moduleTriggers.filter((t) => t.transport === EVENTBUS_TRANSPORT).map((t) => t.event)
    );
    const checked = validateWebhookHandlerResult(result, allowedEventTypes);
    if (!checked.ok) {
      return finish(emptyResponse(500), `invalid handler result: ${checked.reason}`);
    }

    for (const event of checked.events) {
      try {
        await this.publishEvent(event.type, event.data, undefined, undefined, `module/${ids.moduleId}`);
      } catch {
        return finish(emptyResponse(503), `publishing ${event.type} failed`);
      }
    }
    return finish(checked.response);
  },
});
