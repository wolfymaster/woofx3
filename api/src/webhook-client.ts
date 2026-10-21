import type { CallbackEvent, EngineRequest, RequestEnvelope } from "@woofx3/api/webhooks";
import { makeCallbackEnvelope, makeRequestEnvelope } from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import type { DbClient } from "./db-client";
import type { EngineEventStream } from "./engine-event-stream";

// Re-export the shared webhook types so existing engine-side importers
// (./webhook-client) keep working without churn. External clients should
// import from "@woofx3/api/webhooks" directly.
export type {
  ActionDefinition,
  AssetDefinition,
  CallbackEnvelope,
  CallbackEvent,
  EngineResponseReceivedEvent,
  FunctionDefinition,
  ModuleActionDeregisteredEvent,
  ModuleActionRegisteredEvent,
  ModuleAssetDeregisteredEvent,
  ModuleAssetRegisteredEvent,
  ModuleDeletedEvent,
  ModuleDeleteFailedEvent,
  ModuleFunctionDeregisteredEvent,
  ModuleFunctionRegisteredEvent,
  ModuleInstalledEvent,
  ModuleInstallFailedEvent,
  ModuleResourceInstanceCreatedEvent,
  ModuleResourceInstanceDeletedEvent,
  ModuleResourceInstanceUpdatedEvent,
  ModuleResourceUsage,
  ModuleTriggerDeregisteredEvent,
  ModuleTriggerRegisteredEvent,
  ModuleUsageRef,
  ModuleWidgetDeregisteredEvent,
  ModuleWidgetRegisteredEvent,
  ResourceInstanceDefinition,
  TriggerDefinition,
  WidgetBehaviorKind,
  WidgetBehaviorKinds,
  WidgetDefinition,
} from "@woofx3/api/webhooks";
export { EngineEventType, makeCallbackEnvelope } from "@woofx3/api/webhooks";

interface RegisteredInstance {
  clientId: string;
  instanceName: string;
  callbackUrl: string;
  callbackToken: string;
}

/**
 * How long the engine waits for a client to answer a request, over either
 * transport, and for a callback URL to accept an event.
 */
const CALLBACK_TIMEOUT_MS = 5_000;

/**
 * The engine's one path to its clients. Every engine event and request goes
 * through here: the envelope is built once, then delivered over two
 * transports, a POST to each client's callback URL and a push to each of its
 * event stream subscriptions (`EngineEventStream`).
 *
 * Events go both ways: a client that has a callback URL and a subscription
 * gets each one on both, and is idempotent on the envelope id. A request goes
 * one way, chosen per client: its callback URL when it registered one, else
 * its newest event stream subscription.
 */
export class WebhookClient {
  private instances: RegisteredInstance[] = [];
  private readonly timeoutMs = CALLBACK_TIMEOUT_MS;

  constructor(
    private db: DbClient,
    private logger: SharedLogger,
    private stream: EngineEventStream
  ) {}

  /**
   * Engine client ids that can be asked a request: those with a callback URL,
   * then those reachable only over the event stream.
   */
  clientIds(): string[] {
    const ids = this.instances.map((instance) => instance.clientId);
    for (const clientId of this.stream.clientIds()) {
      if (!ids.includes(clientId)) {
        ids.push(clientId);
      }
    }
    return ids;
  }

  async refreshCallbackUrls(): Promise<void> {
    const resp = await this.db.listClients();
    const newInstances: RegisteredInstance[] = [];

    for (const client of resp.clients ?? []) {
      if (client.callbackUrl) {
        newInstances.push({
          clientId: client.clientId,
          instanceName: client.description || client.clientId,
          callbackUrl: client.callbackUrl,
          callbackToken: client.callbackToken,
        });
      }
    }

    this.instances = newInstances;
    this.logger.info("Webhook callback URLs refreshed", { count: this.instances.length });
  }

  /**
   * Deliver `event` to every client, or to `targetClientId` alone. An empty
   * target id throws: it names no client, and broadcasting it instead would
   * send one client's event to all of them.
   */
  async send(event: CallbackEvent, targetClientId?: string): Promise<void> {
    if (targetClientId === "") {
      throw new Error(`WebhookClient.send(${event.type}): targetClientId is empty; omit it to broadcast`);
    }
    const eventType = event.type;
    const envelope = makeCallbackEnvelope(event);
    const streamed = this.stream.publish(envelope, targetClientId);

    let targets = this.instances;
    if (targetClientId !== undefined) {
      targets = this.instances.filter((i) => i.clientId === targetClientId);
    }
    if (targets.length === 0) {
      if (streamed === 0) {
        this.logger.warn("WebhookClient.send: no callback URL or event stream subscription to deliver to", {
          eventType,
          targetClientId: targetClientId ?? "broadcast",
          registeredClients: this.clientIds(),
        });
      }
      return;
    }

    this.logger.info("WebhookClient dispatching event to callback instances", {
      eventType,
      envelopeId: envelope.id,
      targetClientId: targetClientId ?? "broadcast",
      instanceCount: targets.length,
      streamed,
      targets: targets.map((i) => i.instanceName),
    });

    const results = await Promise.allSettled(
      targets.map((instance) =>
        this.sendToUrl(instance.callbackUrl, envelope, instance.instanceName, instance.callbackToken)
      )
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter((r) => r.status === "rejected").length;
    this.logger.info("WebhookClient dispatch complete", { eventType, envelopeId: envelope.id, fulfilled, rejected });
  }

  /**
   * Send a request to one client and return its answer: the parsed JSON
   * response body of its callback URL, or the body it answers with on its
   * event stream when it has no callback URL. Unlike `send`, a request is not
   * retried and does not fail quietly: the caller is waiting on the answer,
   * so a client that is reachable neither way, a refusal (a non-2xx status,
   * or `ok: false`), a timeout or an HTTP body that is not JSON rejects.
   */
  async request(request: EngineRequest, targetClientId: string): Promise<unknown> {
    const envelope = makeRequestEnvelope(request);
    const instance = this.instances.find((i) => i.clientId === targetClientId);
    if (instance) {
      return this.requestOverHttp(instance, envelope);
    }
    if (this.stream.hasSubscriber(targetClientId)) {
      return this.stream.request(envelope, targetClientId, this.timeoutMs);
    }
    throw new Error(`no registered dashboard with client id ${targetClientId}`);
  }

  private async requestOverHttp(instance: RegisteredInstance, envelope: RequestEnvelope): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (instance.callbackToken) {
        headers.Authorization = `Bearer ${instance.callbackToken}`;
      }
      const response = await fetch(instance.callbackUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(envelope),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`${envelope.type}: dashboard answered HTTP ${response.status}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async sendToUrl(url: string, payload: object, instanceName: string, callbackToken: string): Promise<void> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (callbackToken) {
        headers.Authorization = `Bearer ${callbackToken}`;
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok && response.status < 500) {
        this.logger.warn("Webhook delivery failed with client error", {
          url,
          instanceName,
          status: response.status,
        });
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      this.logger.info("Webhook delivered successfully", { url, instanceName, status: response.status });
    } catch (err) {
      this.logger.warn("Webhook delivery failed, retrying once", {
        url,
        instanceName,
        error: err instanceof Error ? err.message : String(err),
      });

      await this.retryOnce(url, payload, instanceName, callbackToken);
    }
  }

  private async retryOnce(url: string, payload: object, instanceName: string, callbackToken: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (callbackToken) {
        headers["Authorization"] = `Bearer ${callbackToken}`;
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        this.logger.error("Webhook retry failed", {
          url,
          instanceName,
          status: response.status,
        });
      } else {
        this.logger.debug("Webhook retry succeeded", { url, instanceName });
      }
    } catch (err) {
      this.logger.error("Webhook retry failed", {
        url,
        instanceName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
