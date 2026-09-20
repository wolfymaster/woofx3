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
import Event from "@woofx3/common/cloudevents/BaseEvent";
import { encode } from "@woofx3/common/cloudevents/utils";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import { RpcTarget } from "capnweb";
import type { DbClient } from "../db-client";
import type { StreamEventBroadcaster } from "../stream-event-broadcaster";
import type { WebhookClient } from "../webhook-client";
import type { WorkflowItem } from "./types";
import { rebuildWorkflowDefinition, timestampToIso } from "./helpers";
import { UNVERSIONED } from "../version";

/**
 * Runs a module function in the barkloader sandbox and waits for its return
 * value. `BarkloaderClient` is the production implementation; a timeout
 * rejects with its `InvokeTimeoutError`.
 */
export interface FunctionInvoker {
  isConnected(): boolean;
  invoke(func: string, event: Record<string, unknown>): Promise<unknown>;
}

export interface ApiOptions {
  db: DbClient;
  nats: NATSClient | null;
  functions: FunctionInvoker | null;
  barkloaderUrl: string;
  streamwareUrl?: string;
  sceneManagerUrl: string;
  apiUrl: string;
  logger: SharedLogger;
  /** The running release (`WOOFX3_VERSION`); "dev" for an unversioned build. */
  version?: string;
}

/**
 * Shared host state and internal helpers for route modules.
 */
export class ApiRouteHost extends RpcTarget {
  protected triggerSubscribers = new Set<{
    onTriggerChange(event: { type: string; moduleName: string }): Promise<void>;
  }>();
  protected webhookClient: WebhookClient | null = null;
  protected streamEventBroadcaster: StreamEventBroadcaster | null = null;
  protected authInvalidate: (() => void) | null = null;

  protected db: DbClient;
  protected nats: NATSClient | null;
  protected functions: FunctionInvoker | null;
  protected applicationId: string | null = null;
  protected barkloaderUrl: string;
  protected streamwareUrl: string;
  protected sceneManagerUrl: string;
  protected apiUrl: string;
  protected logger: SharedLogger;
  protected version: string;

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

  /**
   * The application id, or null when none has been onboarded yet.
   *
   * For NATS handlers, which must not throw: an exception there kills the
   * subscription and stops delivery of everything after it. Route methods
   * should use `ensureApplicationId`, which fails loudly instead.
   */
  protected async tryEnsureApplicationId(context: string): Promise<string | null> {
    try {
      return await this.ensureApplicationId();
    } catch {
      this.logger.warn(`${context}: no applicationId yet; skipping`);
      return null;
    }
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

  /**
   * Publish an event type no shared factory models -- a pass-through of a
   * module-supplied type, or one that belongs to no family.
   *
   * Where a typed factory does exist, prefer `publishEventTuple`: it carries
   * the payload interface, so a field the contract declares cannot be quietly
   * left out.
   */
  protected async publishEvent(
    eventType: string,
    data: Record<string, unknown>,
    subject?: string,
    platform?: string,
    source = "api",
    correlation?: { triggerId?: string; triggeredBy?: string }
  ): Promise<void> {
    // `platform` is a top-level CloudEvents extension attribute, not payload:
    // event types are platform-agnostic, so it is the only thing telling a
    // workflow where a `channel.follow` came from. Omitted rather than empty
    // for events with no originating platform.
    //
    // `correlation` is likewise extension attributes rather than payload, and
    // is grouped into one object because it travels together: a caller that
    // supplies a triggerId is waiting on the run the event causes, and the
    // engine echoes both onto the lifecycle events it emits. Omitted entirely
    // for the events nobody is waiting on, which is most of them.
    const event = Event<Record<string, unknown>>(
      {
        type: eventType,
        source,
        ...(platform ? { platform } : {}),
        ...(correlation?.triggerId ? { triggerId: correlation.triggerId } : {}),
        ...(correlation?.triggeredBy ? { triggeredBy: correlation.triggeredBy } : {}),
      },
      data
    );
    await this.publishBytes(subject || eventType, encode(event), { eventType, eventId: event.id });
  }

  /**
   * Publish an `EventTuple` from one of the shared event factories, which is
   * how every other service publishes.
   */
  protected async publishEventTuple([subject, payload]: [string, Uint8Array]): Promise<void> {
    await this.publishBytes(subject, payload, { eventType: subject });
  }

  private async publishBytes(
    subject: string,
    payload: Uint8Array,
    log: { eventType: string; eventId?: string }
  ): Promise<void> {
    if (!this.nats) {
      this.logger.error("Cannot publish event - NATS client not available", { eventType: log.eventType });
      throw new Error("NATS client not available");
    }

    this.logger.debug("Publishing event to NATS", { ...log, subject });
    await this.nats.publish(subject, payload);
    this.logger.info("Event published successfully", { ...log, subject });
  }

  constructor(opts: ApiOptions) {
    super();
    if (!opts.db) {
      throw new Error("ApiOptions.db is required");
    }
    if (!opts.barkloaderUrl) {
      throw new Error("ApiOptions.barkloaderUrl is required");
    }
    if (!opts.sceneManagerUrl) {
      throw new Error("ApiOptions.sceneManagerUrl is required");
    }
    this.db = opts.db;
    this.nats = opts.nats;
    this.functions = opts.functions;
    this.barkloaderUrl = opts.barkloaderUrl;
    this.streamwareUrl = opts.streamwareUrl ?? "";
    this.sceneManagerUrl = opts.sceneManagerUrl;
    this.apiUrl = opts.apiUrl;
    this.logger = opts.logger;
    this.version = opts.version ?? UNVERSIONED;
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
