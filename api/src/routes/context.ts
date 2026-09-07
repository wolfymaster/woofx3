import type {
  CommandCreatedEvent,
  CommandDeletedEvent,
  CommandUpdatedEvent,
  GroupCreatedEvent,
  GroupDeletedEvent,
  GroupMemberAddedEvent,
  GroupMemberRemovedEvent,
  GroupUpdatedEvent,
  SceneCreatedEvent,
  SceneDeletedEvent,
  SceneUpdatedEvent,
  WorkflowCreatedEvent,
  WorkflowDeletedEvent,
  WorkflowUpdatedEvent,
} from "@woofx3/api/webhooks";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import { RpcTarget } from "capnweb";
import type { DbClient } from "../db-client";
import type { WebhookClient } from "../webhook-client";
import type { WorkflowItem } from "./types";
import { rebuildWorkflowDefinition, timestampToIso } from "./helpers";

export interface ApiOptions {
  db: DbClient;
  nats: NATSClient | null;
  barkloaderUrl: string;
  streamwareUrl?: string;
  overlayPublicUrl?: string;
  logger: SharedLogger;
}

/**
 * Shared host state and internal helpers for route modules.
 */
export class ApiRouteHost extends RpcTarget {

  protected triggerSubscribers = new Set<{
    onTriggerChange(event: { type: string; moduleName: string }): Promise<void>;
  }>();
  protected webhookClient: WebhookClient | null = null;
  protected authInvalidate: (() => void) | null = null;

  protected db: DbClient;
  protected nats: NATSClient | null;
  protected applicationId: string | null = null;
  protected barkloaderUrl: string;
  protected streamwareUrl: string;
  protected overlayPublicUrl: string;
  protected logger: SharedLogger;

  protected getBarkloaderBaseUrl(): string {
    return this.barkloaderUrl.endsWith("/") ? this.barkloaderUrl.slice(0, -1) : this.barkloaderUrl;
  }

  protected async barkloaderRequest(path: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(`${this.getBarkloaderBaseUrl()}${path}`, init);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Barkloader request failed (${response.status} ${response.statusText}): ${body || "empty body"}`);
    }
    return response;
  }

  protected workflowToItem(wf: {
    id?: string;
    name?: string;
    description?: string;
    applicationId?: string;
    enabled?: boolean;
    stepsJson?: string;
    triggerJson?: string;
    createdAt?: { seconds?: bigint; nanos?: number };
    updatedAt?: { seconds?: bigint; nanos?: number };
    taxonomy?: string[];
  }): WorkflowItem {
    return {
      id: wf.id ?? "",
      name: wf.name ?? "",
      description: wf.description ?? "",
      accountId: wf.applicationId ?? "",
      isEnabled: wf.enabled ?? false,
      definition: rebuildWorkflowDefinition(wf),
      stats: { runsToday: 0, successRate: 100 },
      createdAt: timestampToIso(wf.createdAt),
      updatedAt: timestampToIso(wf.updatedAt),
      taxonomy: wf.taxonomy ?? [],
    };
  }

  protected async emitWorkflowWebhook(
    event: WorkflowCreatedEvent | WorkflowUpdatedEvent | WorkflowDeletedEvent
  ): Promise<void> {
    if (!this.webhookClient) {
      this.logger.warn("No webhook client set, skipping workflow webhook", { type: event.type });
      return;
    }
    try {
      await this.webhookClient.send(event);
    } catch (err) {
      this.logger.error("Failed to send workflow webhook", { type: event.type, err });
    }
  }

  protected async emitCommandWebhook(
    event: CommandCreatedEvent | CommandUpdatedEvent | CommandDeletedEvent
  ): Promise<void> {
    if (!this.webhookClient) {
      this.logger.warn("No webhook client set, skipping command webhook", { type: event.type });
      return;
    }
    try {
      await this.webhookClient.send(event);
    } catch (err) {
      this.logger.error("Failed to send command webhook", { type: event.type, err });
    }
  }

  protected async emitGroupWebhook(
    event: GroupCreatedEvent | GroupUpdatedEvent | GroupDeletedEvent | GroupMemberAddedEvent | GroupMemberRemovedEvent
  ): Promise<void> {
    if (!this.webhookClient) {
      this.logger.warn("No webhook client set, skipping group webhook", { type: event.type });
      return;
    }
    try {
      await this.webhookClient.send(event);
    } catch (err) {
      this.logger.error("Failed to send group webhook", { type: event.type, err });
    }
  }

  protected async emitSceneWebhook(event: SceneCreatedEvent | SceneUpdatedEvent | SceneDeletedEvent): Promise<void> {
    if (!this.webhookClient) {
      this.logger.warn("No webhook client set, skipping scene webhook", { type: event.type });
      return;
    }
    try {
      await this.webhookClient.send(event);
    } catch (err) {
      this.logger.error("Failed to send scene webhook", { type: event.type, err });
    }
  }

  protected async ensureApplicationId(): Promise<string> {
    if (this.applicationId) {
      return this.applicationId;
    }
    const app = await this.db.getDefaultApplication();
    if (!app) {
      throw new Error("No default application; complete UI onboarding first");
    }
    this.applicationId = app.id;
    if (this.webhookClient) {
      this.webhookClient.setApplicationId(app.id);
      void this.webhookClient.refreshCallbackUrls();
    }
    return app.id;
  }

  protected async notifyTriggerChange(moduleName: string): Promise<void> {
    type Subscriber = { onTriggerChange(event: { type: string; moduleName: string }): Promise<void> };
    const dead: Subscriber[] = [];
    for (const cb of this.triggerSubscribers) {
      try {
        await cb.onTriggerChange({ type: "registered", moduleName });
      } catch {
        dead.push(cb);
      }
    }
    for (const cb of dead) {
      this.triggerSubscribers.delete(cb);
    }
  }

  protected async publishEvent(eventType: string, data: Record<string, unknown>, subject?: string): Promise<void> {
    if (!this.nats) {
      this.logger.error("Cannot publish event - NATS client not available", { eventType });
      throw new Error("NATS client not available");
    }

    const eventId = crypto.randomUUID();
    const event = {
      id: eventId,
      type: eventType,
      source: "api",
      time: new Date().toISOString(),
      data,
    };

    const eventData = new TextEncoder().encode(JSON.stringify(event));
    const eventSubject = subject || eventType;

    this.logger.debug("Publishing event to NATS", {
      eventType,
      eventId,
      subject: eventSubject,
    });

    await this.nats.publish(eventSubject, eventData);

    this.logger.info("Event published successfully", {
      eventType,
      eventId,
      subject: eventSubject,
    });
  }

  constructor(opts: ApiOptions) {
    super();
    if (!opts.db) {
      throw new Error("ApiOptions.db is required");
    }
    if (!opts.barkloaderUrl) {
      throw new Error("ApiOptions.barkloaderUrl is required");
    }
    this.db = opts.db;
    this.nats = opts.nats;
    this.barkloaderUrl = opts.barkloaderUrl;
    this.streamwareUrl = opts.streamwareUrl ?? "";
    this.overlayPublicUrl = opts.overlayPublicUrl ?? "http://127.0.0.1:9100";
    this.logger = opts.logger;
  }
}

/**
 * Declare a route module.
 *
 * Route modules are plain object literals whose methods are copied onto the
 * Api prototype by `registerAllRoutes`, so at runtime `this` is an
 * `ApiRouteHost`. Nothing said so at compile time: TypeScript types `this`
 * inside an object literal as the literal itself, so every `this.db` resolved
 * against a bag of sibling methods and failed. Wrapping the literal supplies
 * the contextual `ThisType` that makes `this` mean what it means at runtime.
 *
 * The identity function is the whole implementation; `T` is inferred from the
 * literal so the module's own shape is preserved exactly and
 * `RegisteredApiRoutes` still derives from it.
 *
 * `ThisType<ApiRouteHost>` is deliberately not an intersection. Two
 * constraints force that:
 *
 *   - `ThisType<ApiRouteHost & RegisteredApiRoutes>` is circular, since
 *     `RegisteredApiRoutes` is itself derived from `typeof` these modules.
 *   - Any intersection at all, even with an empty interface, makes the host's
 *     `protected` members inaccessible.
 *
 * So a route module can reach the host and its own methods, and nothing else.
 * Behaviour shared between route modules belongs in a module both import, not
 * on `this`.
 */
export function routeModule<T>(routes: T & ThisType<ApiRouteHost>): T {
  return routes;
}
