import type { CallbackEvent, EngineRequest, RequestEnvelope } from "@woofx3/api/webhooks";
import { makeCallbackEnvelope, makeRequestEnvelope } from "@woofx3/api/webhooks";
import { isLoopbackHostname } from "@woofx3/common/http/request-guard";
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

export interface WebhookClientConfig {
  /**
   * How long the engine waits for a client to answer a request, over either
   * transport, and for a callback URL to accept an event, its response body
   * included.
   */
  timeoutMs: number;
  /** The pause before the one retry of a failed event delivery. */
  retryDelayMs: number;
  /** The most of a callback response body the engine reads; a request answered with more fails. */
  maxResponseBytes: number;
}

/** A request's answer is a small JSON value; anything bigger is refused rather than buffered. */
export const MAX_CALLBACK_RESPONSE_BYTES = 64 * 1024;

export const DEFAULT_WEBHOOK_CLIENT_CONFIG: WebhookClientConfig = {
  timeoutMs: 5_000,
  retryDelayMs: 1_000,
  maxResponseBytes: MAX_CALLBACK_RESPONSE_BYTES,
};

/** What a callback URL answered a POST with. */
interface CallbackReply {
  status: number;
  body: string;
  /** True when the body ran past `maxResponseBytes`; `body` is then empty. */
  overflowed: boolean;
}

/**
 * Why `url` cannot be a client's callback URL, or null when it can. The
 * engine POSTs every event there with the client's callback token, so only
 * https is allowed, or plain http to this machine; credentials in the URL and
 * fragments are refused as well. The https host is not checked against private
 * or link-local ranges: only an admitted registrant (first client, or one
 * holding the registration token) can set a callback URL, and it is trusted to
 * choose where its own events go. A name check alone could not stop a DNS name
 * that resolves to such an address anyway.
 */
export function callbackUrlRefusal(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "it is not an absolute URL";
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return "it carries credentials; pass them as the callback token instead";
  }
  if (url.includes("#")) {
    return "it has a fragment";
  }
  if (parsed.protocol === "https:") {
    return null;
  }
  if (parsed.protocol === "http:") {
    return isLoopbackHostname(parsed.hostname) ? null : "plain http is only allowed to a loopback host";
  }
  return `the ${parsed.protocol} scheme is not allowed; use https`;
}

/** Reads at most `maxBytes` of `response`'s body, cancelling the rest of the stream past that. */
async function readCapped(response: Response, maxBytes: number): Promise<{ body: string; overflowed: boolean }> {
  if (response.body === null) {
    return { body: "", overflowed: false };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { body: "", overflowed: true };
    }
    chunks.push(value);
  }
  return { body: new TextDecoder().decode(Buffer.concat(chunks)), overflowed: false };
}

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

  constructor(
    private db: DbClient,
    private logger: SharedLogger,
    private stream: EngineEventStream,
    private readonly config: WebhookClientConfig
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
        const refusal = callbackUrlRefusal(client.callbackUrl);
        if (refusal !== null) {
          this.logger.warn("Skipping a client whose stored callback URL is no longer accepted", {
            clientId: client.clientId,
            reason: refusal,
          });
          continue;
        }
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

    const results = await Promise.allSettled(targets.map((instance) => this.sendToUrl(instance, envelope)));

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
      return this.stream.request(envelope, targetClientId, this.config.timeoutMs);
    }
    throw new Error(`no registered dashboard with client id ${targetClientId}`);
  }

  private async requestOverHttp(instance: RegisteredInstance, envelope: RequestEnvelope): Promise<unknown> {
    const reply = await this.post(instance, envelope);
    if (!isSuccess(reply.status)) {
      throw new Error(`${envelope.type}: dashboard answered HTTP ${reply.status}`);
    }
    if (reply.overflowed) {
      throw new Error(`${envelope.type}: dashboard answered with more than ${this.config.maxResponseBytes} bytes`);
    }
    return JSON.parse(reply.body);
  }

  private async sendToUrl(instance: RegisteredInstance, payload: object): Promise<void> {
    const { callbackUrl: url, instanceName } = instance;
    try {
      const reply = await this.post(instance, payload);
      if (!isSuccess(reply.status) && reply.status < 500) {
        this.logger.warn("Webhook delivery failed with client error", { url, instanceName, status: reply.status });
        return;
      }
      if (!isSuccess(reply.status)) {
        throw new Error(`HTTP ${reply.status}`);
      }
      this.logger.info("Webhook delivered successfully", { url, instanceName, status: reply.status });
    } catch (err) {
      this.logger.warn("Webhook delivery failed, retrying once", {
        url,
        instanceName,
        error: err instanceof Error ? err.message : String(err),
      });
      await this.retryOnce(instance, payload);
    }
  }

  private async retryOnce(instance: RegisteredInstance, payload: object): Promise<void> {
    const { callbackUrl: url, instanceName } = instance;
    await new Promise((resolve) => setTimeout(resolve, this.config.retryDelayMs));
    try {
      const reply = await this.post(instance, payload);
      if (!isSuccess(reply.status)) {
        this.logger.error("Webhook retry failed", { url, instanceName, status: reply.status });
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

  /**
   * POSTs `body` to `instance`'s callback URL with its callback token. A
   * redirect is an error rather than followed: a 307 or 308 would resend the
   * event, token and all, to wherever the callback points it. The timeout
   * covers reading the (capped) response body too.
   */
  private async post(instance: RegisteredInstance, body: object): Promise<CallbackReply> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (instance.callbackToken) {
        headers.Authorization = `Bearer ${instance.callbackToken}`;
      }
      const response = await fetch(instance.callbackUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        redirect: "error",
        signal: controller.signal,
      });
      const read = await readCapped(response, this.config.maxResponseBytes);
      return { status: response.status, ...read };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}
