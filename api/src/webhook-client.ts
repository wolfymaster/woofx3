import type { CallbackEvent } from "@woofx3/api/webhooks";
import { makeCallbackEnvelope } from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import type { DbClient } from "./db-client";

// Re-export the shared webhook types so existing engine-side importers
// (./webhook-client) keep working without churn. External clients should
// import from "@woofx3/api/webhooks" directly.
export type {
  ActionDefinition,
  CallbackEnvelope,
  CallbackEvent,
  ModuleActionRegisteredEvent,
  ModuleDeletedEvent,
  ModuleDeleteFailedEvent,
  ModuleInstalledEvent,
  ModuleInstallFailedEvent,
  ModuleResourceUsage,
  ModuleTriggerRegisteredEvent,
  ModuleUsageRef,
  TriggerDefinition,
} from "@woofx3/api/webhooks";
export { EngineEventType, makeCallbackEnvelope } from "@woofx3/api/webhooks";

interface RegisteredInstance {
  clientId: string;
  instanceName: string;
  callbackUrl: string;
  callbackToken: string;
}

export class WebhookClient {
  private instances: RegisteredInstance[] = [];
  private readonly timeoutMs = 5_000;

  constructor(
    private db: DbClient,
    private logger: SharedLogger,
    private applicationId: string
  ) {
    this.refreshCallbackUrls();
  }

  setApplicationId(applicationId: string): void {
    this.applicationId = applicationId;
  }

  async refreshCallbackUrls(): Promise<void> {
    const resp = await this.db.listClients(this.applicationId);
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

  async send(event: CallbackEvent, targetClientId?: string): Promise<void> {
    const eventType = event.type;

    if (this.instances.length === 0) {
      this.logger.warn("WebhookClient.send called but no callback instances registered", { eventType, targetClientId });
      return;
    }

    const envelope = makeCallbackEnvelope(event);

    let targets = this.instances;
    if (targetClientId) {
      targets = this.instances.filter((i) => i.clientId === targetClientId);
      if (targets.length === 0) {
        this.logger.warn("WebhookClient.send: target clientId not found among registered instances", {
          eventType,
          targetClientId,
          registeredClients: this.instances.map((i) => i.clientId),
        });
        return;
      }
    }

    this.logger.info("WebhookClient dispatching event to callback instances", {
      eventType,
      envelopeId: envelope.id,
      targetClientId: targetClientId ?? "broadcast",
      instanceCount: targets.length,
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
