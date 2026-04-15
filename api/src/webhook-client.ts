import type { Logger } from "winston";
import type { DbClient } from "./db-client";

interface RegisteredInstance {
  instanceName: string;
  callbackUrl: string;
  callbackToken: string;
}

export class WebhookClient {
  private instances: RegisteredInstance[] = [];
  private readonly timeoutMs = 5_000;

  constructor(
    private db: DbClient,
    private logger: Logger,
    private applicationId: string
  ) {
    this.refreshCallbackUrls();
  }

  async refreshCallbackUrls(): Promise<void> {
    const resp = await this.db.listClients(this.applicationId);
    const newInstances: RegisteredInstance[] = [];

    for (const client of resp.clients ?? []) {
      if (client.callbackUrl) {
        newInstances.push({
          instanceName: client.description || client.clientId,
          callbackUrl: client.callbackUrl,
          callbackToken: client.callbackToken,
        });
      }
    }

    this.instances = newInstances;
    this.logger.info("Webhook callback URLs refreshed", { count: this.instances.length });
  }

  async send(event: Record<string, unknown>): Promise<void> {
    if (this.instances.length === 0) {
      return;
    }

    const envelope = {
      id: crypto.randomUUID(),
      source: "engine",
      type: (event["type"] as string) ?? "engine.event",
      time: new Date().toISOString(),
      data: event,
    };

    const promises = this.instances.map((instance) =>
      this.sendToUrl(instance.callbackUrl, envelope, instance.instanceName, instance.callbackToken)
    );

    await Promise.allSettled(promises);
  }

  private async sendToUrl(url: string, payload: object, instanceName: string, callbackToken: string): Promise<void> {
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

      this.logger.debug("Webhook delivered", { url, instanceName });
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
