import type { EngineHosting, UISetting } from "@woofx3/api";
import type {
  CallbackEvent,
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
import { EngineEventType } from "@woofx3/api/webhooks";
import Event from "@woofx3/common/cloudevents/BaseEvent";
import {
  RELAY_CONFIG_SETTING,
  RELAY_CONFIG_UPDATED_SUBJECT,
  readStoredRelayConfig,
  type StoredRelayConfig,
} from "@woofx3/common/cloudevents/Relay/relay";
import { encode } from "@woofx3/common/cloudevents/utils";
import {
  INTEGRATION_ENABLED_UPDATED_SUBJECT,
  INTEGRATION_TOKEN_UPDATED_SUBJECT,
  type IntegrationEventPayloads,
  type IntegrationId,
  integrationEnabledSettingKey,
} from "@woofx3/common/integrations/integration-settings";
import type { SharedLogger } from "@woofx3/common/logging";
import type NATSClient from "@woofx3/nats/src/client";
import { TwitchOAuthClient } from "@woofx3/twitch/oauth";
import { RpcTarget } from "capnweb";
import type { DbClient } from "../db-client";
import type { EngineEventStream } from "../engine-event-stream";
import type { EventLogSelectionSource } from "../event-log-selection";
import { releaseStub } from "../held-stub";
import type { MarketplaceClient } from "../marketplace-client";
import { RelayCredentialSource } from "../relay-credential-source";
import type { StreamEventBroadcaster } from "../stream-event-broadcaster";
import { TwitchDeviceLogins } from "../twitch-device-login";
import { TwitchProfiles } from "../twitch-profiles";
import { type TwitchLinkChange, TwitchTokenSource } from "../twitch-token-source";
import { UNVERSIONED } from "../version";
import type { WebhookClient } from "../webhook-client";
import { rebuildWorkflowDefinition, timestampToIso } from "./helpers";
import type { WorkflowItem } from "./types";

/**
 * How long a request to the engine waits for its answer. The engine answers
 * as soon as it has decided -- before any step runs -- so this only expires
 * when nothing is listening.
 */
const ENGINE_REQUEST_TIMEOUT_MS = 5_000;

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
  /** The engine secret barkloader authenticates its management routes with. */
  barkloaderKey: string;
  streamwareUrl?: string;
  sceneManagerUrl: string;
  apiUrl: string;
  logger: SharedLogger;
  /** The running release (`WOOFX3_VERSION`); "dev" for an unversioned build. */
  version?: string;
  /** How this engine is run (`WOOFX3_HOSTING`), or null when the deployment does not say. */
  hosting?: EngineHosting | null;
  /** The marketplace to install and read the catalog from; null or absent when it is turned off. */
  marketplace?: MarketplaceClient | null;
  /** The engine's public Twitch app (`WOOFX3_TWITCH_PUBLIC_CLIENT_ID`), for device logins; null or absent when it has none. */
  twitchPublicClientId?: string | null;
  /** The engine's confidential Twitch app (`WOOFX3_TWITCH_CLIENT_ID`); null or absent when it has none. */
  twitchClientId?: string | null;
  /** Twitch's OAuth endpoints; Twitch itself when absent. */
  twitchOAuth?: TwitchOAuthClient;
  /** Epoch milliseconds now; `Date.now` when absent. */
  clock?: () => number;
}

async function barkloaderRequestError(response: Response): Promise<Error> {
  const body = await response.text();
  return new Error(`Barkloader request failed (${response.status} ${response.statusText}): ${body || "empty body"}`);
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
  protected engineEventStream: EngineEventStream | null = null;
  protected eventLogSelection: EventLogSelectionSource | null = null;
  protected authInvalidate: ((clientId: string) => void) | null = null;
  /**
   * The linked Twitch account's token. An instance property, not a method,
   * so capnweb never offers it to a client.
   */
  readonly twitchToken: TwitchTokenSource;
  /** The companion bridge's credential. An instance property for the same reason as `twitchToken`. */
  readonly relayCredential: RelayCredentialSource;
  /** Twitch device logins in progress. An instance property for the same reason as `twitchToken`. */
  readonly twitchDeviceLogins: TwitchDeviceLogins;
  /** The linked account's Helix profile. An instance property for the same reason as `twitchToken`. */
  readonly twitchProfiles: TwitchProfiles;

  protected db: DbClient;
  protected nats: NATSClient | null;
  protected functions: FunctionInvoker | null;
  protected barkloaderUrl: string;
  /** An instance property for the same reason as `twitchToken`. */
  protected readonly barkloaderKey: string;
  protected streamwareUrl: string;
  protected sceneManagerUrl: string;
  protected apiUrl: string;
  protected logger: SharedLogger;
  protected version: string;
  protected hosting: EngineHosting | null;
  protected marketplace: MarketplaceClient | null;
  protected readonly clock: () => number;

  protected getBarkloaderBaseUrl(): string {
    return this.barkloaderUrl.endsWith("/") ? this.barkloaderUrl.slice(0, -1) : this.barkloaderUrl;
  }

  /** The one way to reach barkloader's HTTP routes: every one but public asset reads needs the bearer. */
  protected barkloaderFetch(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${this.barkloaderKey}`);
    return fetch(`${this.getBarkloaderBaseUrl()}${path}`, { ...init, headers });
  }

  protected async barkloaderRequest(path: string, init?: RequestInit): Promise<Response> {
    const response = await this.barkloaderFetch(path, init);
    if (!response.ok) {
      throw await barkloaderRequestError(response);
    }
    return response;
  }

  /**
   * `barkloaderRequest` for a lookup where "not there" is an expected
   * answer: a 404 resolves to null instead of throwing. Every other failure
   * still throws.
   */
  protected async barkloaderRequestOrNull(path: string, init?: RequestInit): Promise<Response | null> {
    const response = await this.barkloaderFetch(path, init);
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      throw await barkloaderRequestError(response);
    }
    return response;
  }

  protected workflowToItem(wf: {
    id?: string;
    name?: string;
    description?: string;
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
      isEnabled: wf.enabled ?? false,
      definition: rebuildWorkflowDefinition(wf),
      stats: { runsToday: 0, successRate: 100 },
      createdAt: timestampToIso(wf.createdAt),
      updatedAt: timestampToIso(wf.updatedAt),
      taxonomy: wf.taxonomy ?? [],
    };
  }

  /** Best effort: a failed or unconfigured send is logged, never thrown. */
  protected async emitWebhook(event: CallbackEvent, context: Record<string, unknown>): Promise<void> {
    if (!this.webhookClient) {
      this.logger.warn("No webhook client set, skipping webhook", { type: event.type, ...context });
      return;
    }
    try {
      await this.webhookClient.send(event);
    } catch (err) {
      this.logger.error("Failed to send webhook", { type: event.type, ...context, err });
    }
  }

  protected async emitWorkflowWebhook(
    event: WorkflowCreatedEvent | WorkflowUpdatedEvent | WorkflowDeletedEvent
  ): Promise<void> {
    await this.emitWebhook(event, {});
  }

  protected async emitCommandWebhook(
    event: CommandCreatedEvent | CommandUpdatedEvent | CommandDeletedEvent
  ): Promise<void> {
    await this.emitWebhook(event, {});
  }

  protected async emitGroupWebhook(
    event: GroupCreatedEvent | GroupUpdatedEvent | GroupDeletedEvent | GroupMemberAddedEvent | GroupMemberRemovedEvent
  ): Promise<void> {
    await this.emitWebhook(event, {});
  }

  protected async emitSceneWebhook(event: SceneCreatedEvent | SceneUpdatedEvent | SceneDeletedEvent): Promise<void> {
    await this.emitWebhook(event, {});
  }

  /** Announces a local UI setting write. Best effort: a reader that missed it pages the changes. */
  protected async emitUISettingWebhook(setting: UISetting): Promise<void> {
    await this.emitWebhook(
      {
        type: EngineEventType.UI_SETTING_CHANGED,
        namespace: setting.namespace,
        key: setting.key,
        revision: setting.revision,
        deleted: setting.deleted,
        value: setting.value,
      },
      { namespace: setting.namespace, key: setting.key }
    );
  }

  /**
   * Forgets the old account's profile and announces the change. The webhook
   * is best effort: a reader that missed it reads `getTwitchLink`.
   */
  private onTwitchLinkChanged(change: TwitchLinkChange): void {
    this.twitchProfiles.forget();
    void this.emitWebhook(
      { type: EngineEventType.TWITCH_LINK_CHANGED, ...change },
      { revision: change.revision, twitchUserId: change.linked ? change.userId : null }
    );
  }

  /**
   * Write the linked Twitch account's token, mark the integration enabled and
   * tell the services that hold one to reload it. `engineUserId` scopes the
   * row to the engine user who linked it, when known.
   *
   * Linking again re-enables, so a Convex re-registration (which calls
   * setTwitchToken) switches a disabled integration back on.
   */
  protected async storeTwitchToken<T extends { userId: string }>(stored: T, engineUserId?: string): Promise<void> {
    await this.twitchToken.store(stored, engineUserId);
    await this.writeIntegrationEnabled("twitch", true);
    await this.announceIntegrationChanged("twitch", true);
  }

  /**
   * Record whether an integration should run. The token and this row are two
   * writes, not one transaction: an adapter runs while it is connected AND
   * enabled, and the host's 60 s reconcile heals a missed event or a crash
   * between the writes. Throws when the row is not stored, so the RPC fails
   * rather than reporting a link the host will not act on.
   */
  protected async writeIntegrationEnabled(id: IntegrationId, enabled: boolean): Promise<void> {
    const key = integrationEnabledSettingKey(id);
    if (!(await this.db.trySetSetting(key, String(enabled)))) {
      throw new Error(`could not store ${key}`);
    }
  }

  /**
   * Engine `settings` writes publish no event of their own. The enabled event
   * goes first so a listener that reacts to the token event already sees the
   * new flag. Each publish is best effort: the rows are written, so a missed
   * event only delays the pickup until the next reconcile.
   */
  protected async announceIntegrationChanged(id: IntegrationId, enabled: boolean): Promise<void> {
    await this.publishBestEffort(INTEGRATION_ENABLED_UPDATED_SUBJECT, { integration: id, enabled });
    await this.publishBestEffort(INTEGRATION_TOKEN_UPDATED_SUBJECT, { integration: id });
  }

  private async publishBestEffort<S extends keyof IntegrationEventPayloads>(
    subject: S,
    payload: IntegrationEventPayloads[S]
  ): Promise<void> {
    try {
      await this.publishEvent(subject, payload);
    } catch (err) {
      this.logger.warn(`Failed to publish ${subject}`, { err });
    }
  }

  private async writeRelayConfig(config: StoredRelayConfig): Promise<void> {
    if (!(await this.db.trySetSetting(RELAY_CONFIG_SETTING, JSON.stringify(config)))) {
      throw new Error(`could not store ${RELAY_CONFIG_SETTING}`);
    }
    await this.announceRelayConfig();
  }

  private async deleteRelayConfig(): Promise<void> {
    await this.db.deleteSetting(RELAY_CONFIG_SETTING);
    await this.announceRelayConfig();
  }

  /**
   * Engine `settings` writes publish no event of their own. Best effort: the
   * setting is already written, and sceneManager re-reads it on every connect
   * attempt, so a missed announcement only delays the switch.
   */
  private async announceRelayConfig(): Promise<void> {
    try {
      await this.publishEvent(RELAY_CONFIG_UPDATED_SUBJECT, { at: new Date().toISOString() });
    } catch (err) {
      this.logger.warn(`Failed to publish ${RELAY_CONFIG_UPDATED_SUBJECT}`, { err });
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
      if (this.triggerSubscribers.delete(cb)) {
        releaseStub(cb);
      }
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
   * Send a CloudEvent as a NATS request and decode the receiver's JSON reply.
   *
   * For a command whose caller needs the receiver's answer, where
   * `publishEvent` would return before the receiver had decided anything.
   * Built like `publishEvent`, so a receiver subscribed to the same subject
   * reads either the same way.
   */
  protected async requestEvent<T>(
    eventType: string,
    data: Record<string, unknown>,
    correlation?: { triggerId?: string; triggeredBy?: string },
    timeoutMs = ENGINE_REQUEST_TIMEOUT_MS
  ): Promise<T> {
    const event = Event<Record<string, unknown>>(
      {
        type: eventType,
        source: "api",
        ...(correlation?.triggerId ? { triggerId: correlation.triggerId } : {}),
        ...(correlation?.triggeredBy ? { triggeredBy: correlation.triggeredBy } : {}),
      },
      data
    );
    return this.requestBytes<T>(eventType, encode(event), timeoutMs);
  }

  /** Send a plain JSON body as a NATS request and decode the JSON reply. */
  protected async requestJson<T>(subject: string, body: unknown, timeoutMs = ENGINE_REQUEST_TIMEOUT_MS): Promise<T> {
    return this.requestBytes<T>(subject, new TextEncoder().encode(JSON.stringify(body)), timeoutMs);
  }

  private async requestBytes<T>(subject: string, payload: Uint8Array, timeoutMs: number): Promise<T> {
    if (!this.nats) {
      throw new Error("NATS client not available");
    }
    let reply: { data: Uint8Array };
    try {
      reply = await this.nats.request(subject, payload, { timeout: timeoutMs });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`No answer on ${subject} (is the workflow engine running?): ${detail}`);
    }
    return JSON.parse(new TextDecoder().decode(reply.data)) as T;
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
    if (!opts.barkloaderKey) {
      throw new Error("ApiOptions.barkloaderKey is required");
    }
    if (!opts.sceneManagerUrl) {
      throw new Error("ApiOptions.sceneManagerUrl is required");
    }
    this.db = opts.db;
    const twitchOAuth = opts.twitchOAuth ?? new TwitchOAuthClient();
    this.twitchToken = new TwitchTokenSource({
      db: this.db,
      dashboard: () => this.webhookClient,
      ownClientId: opts.twitchClientId ?? null,
      publicClient: twitchOAuth,
      onLinkChanged: (change) => this.onTwitchLinkChanged(change),
      now: opts.clock,
    });
    this.twitchProfiles = new TwitchProfiles({ logger: opts.logger, now: opts.clock });
    this.twitchDeviceLogins = new TwitchDeviceLogins({
      clientId: opts.twitchPublicClientId ?? null,
      oauth: twitchOAuth,
      storeToken: (token) => this.storeTwitchToken(token),
      logger: opts.logger,
    });
    this.relayCredential = new RelayCredentialSource({
      dashboard: () => this.webhookClient,
      readConfig: async () => readStoredRelayConfig(await this.db.getSetting(RELAY_CONFIG_SETTING)),
      writeConfig: (config) => this.writeRelayConfig(config),
      clearConfig: () => this.deleteRelayConfig(),
      now: () => Date.now(),
    });
    this.nats = opts.nats;
    this.functions = opts.functions;
    this.barkloaderUrl = opts.barkloaderUrl;
    this.barkloaderKey = opts.barkloaderKey;
    this.streamwareUrl = opts.streamwareUrl ?? "";
    this.sceneManagerUrl = opts.sceneManagerUrl;
    this.apiUrl = opts.apiUrl;
    this.logger = opts.logger;
    this.version = opts.version ?? UNVERSIONED;
    this.hosting = opts.hosting ?? null;
    this.marketplace = opts.marketplace ?? null;
    this.clock = opts.clock ?? (() => Date.now());
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
