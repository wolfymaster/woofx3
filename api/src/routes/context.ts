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
  logger: SharedLogger;
}

/**
 * Shared host state and internal helpers for route modules.
 */
export class ApiRouteHost extends RpcTarget {
  protected static readonly MARKETPLACE_FETCH_TIMEOUT_MS = 30_000;
  protected static readonly MARKETPLACE_MAX_BYTES = 50 * 1024 * 1024;

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
  protected logger: SharedLogger;

  protected currentUser = {
    id: "user-1",
    email: "streamer@example.com",
    displayName: "ProStreamer",
    role: "owner",
    teamIds: ["team-1", "team-2"],
    accountIds: ["account-1", "account-2", "account-3"],
    createdAt: "2024-01-01T00:00:00Z",
  };

  protected teams = [
    {
      id: "team-1",
      name: "Main Stream Team",
      slug: "main-stream",
      ownerId: "user-1",
      createdAt: "2024-01-15T00:00:00Z",
    },
    { id: "team-2", name: "Collab Squad", slug: "collab-squad", ownerId: "user-1", createdAt: "2024-06-01T00:00:00Z" },
  ];

  protected accounts = [
    {
      id: "account-1",
      name: "MainTwitch",
      displayName: "WoofyStream",
      slug: "woofy-stream",
      platform: "twitch",
      teamId: "team-1",
      status: "connected",
      createdAt: "2024-01-15T00:00:00Z",
    },
    {
      id: "account-2",
      name: "YouTubeGaming",
      displayName: "Woofy Gaming",
      slug: "woofy-gaming",
      platform: "youtube",
      teamId: "team-1",
      status: "connected",
      createdAt: "2024-03-01T00:00:00Z",
    },
    {
      id: "account-3",
      name: "CollabTwitch",
      displayName: "Collab Stream",
      slug: "collab-stream",
      platform: "twitch",
      teamId: "team-2",
      status: "connected",
      createdAt: "2024-06-15T00:00:00Z",
    },
  ];

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

  protected workflowRuns: Array<{
    id: string;
    workflowId: string;
    accountId: string;
    status: string;
    startedAt: string;
    duration: number;
    trigger: string;
  }> = [
    {
      id: "run-1",
      workflowId: "wf-1",
      accountId: "account-1",
      status: "success",
      startedAt: "2026-01-14T04:30:00Z",
      duration: 1200,
      trigger: "follow",
    },
    {
      id: "run-2",
      workflowId: "wf-2",
      accountId: "account-1",
      status: "success",
      startedAt: "2026-01-14T03:15:00Z",
      duration: 3500,
      trigger: "subscription",
    },
    {
      id: "run-3",
      workflowId: "wf-4",
      accountId: "account-1",
      status: "failed",
      startedAt: "2026-01-14T02:45:00Z",
      duration: 800,
      trigger: "cheer",
    },
    {
      id: "run-4",
      workflowId: "wf-1",
      accountId: "account-1",
      status: "success",
      startedAt: "2026-01-14T01:00:00Z",
      duration: 950,
      trigger: "follow",
    },
    {
      id: "run-5",
      workflowId: "wf-6",
      accountId: "account-1",
      status: "running",
      startedAt: "2026-01-14T00:00:00Z",
      duration: 0,
      trigger: "stream.online",
    },
    {
      id: "run-6",
      workflowId: "wf-5",
      accountId: "account-2",
      status: "success",
      startedAt: "2026-01-13T22:30:00Z",
      duration: 450,
      trigger: "redemption",
    },
    {
      id: "run-7",
      workflowId: "wf-5",
      accountId: "account-2",
      status: "success",
      startedAt: "2026-01-13T21:00:00Z",
      duration: 380,
      trigger: "redemption",
    },
  ];

  protected mockAssets = [
    {
      id: "asset-1",
      name: "Follow Alert",
      type: "image",
      url: "/assets/follow.gif",
      accountId: "account-1",
      size: 256000,
      createdAt: "2024-06-01T00:00:00Z",
    },
    {
      id: "asset-2",
      name: "Sub Sound",
      type: "audio",
      url: "/assets/sub.mp3",
      accountId: "account-1",
      size: 512000,
      createdAt: "2024-06-15T00:00:00Z",
    },
    {
      id: "asset-3",
      name: "Raid Video",
      type: "video",
      url: "/assets/raid.mp4",
      accountId: "account-1",
      size: 2048000,
      createdAt: "2024-07-01T00:00:00Z",
    },
    {
      id: "asset-4",
      name: "Logo",
      type: "image",
      url: "/assets/logo.png",
      accountId: "account-1",
      size: 128000,
      createdAt: "2024-01-15T00:00:00Z",
    },
    {
      id: "asset-5",
      name: "Intro Music",
      type: "audio",
      url: "/assets/intro.mp3",
      accountId: "account-1",
      size: 1024000,
      createdAt: "2024-02-01T00:00:00Z",
    },
    {
      id: "asset-6",
      name: "Outro Video",
      type: "video",
      url: "/assets/outro.mp4",
      accountId: "account-1",
      size: 4096000,
      createdAt: "2024-03-01T00:00:00Z",
    },
    {
      id: "asset-7",
      name: "Emote Pack",
      type: "image",
      url: "/assets/emotes.zip",
      accountId: "account-1",
      size: 768000,
      createdAt: "2024-04-01T00:00:00Z",
    },
    {
      id: "asset-8",
      name: "Alert Sound",
      type: "audio",
      url: "/assets/alert.wav",
      accountId: "account-1",
      size: 384000,
      createdAt: "2024-05-01T00:00:00Z",
    },
    {
      id: "asset-9",
      name: "BRB Screen",
      type: "image",
      url: "/assets/brb.png",
      accountId: "account-2",
      size: 192000,
      createdAt: "2024-08-01T00:00:00Z",
    },
    {
      id: "asset-10",
      name: "Donation Sound",
      type: "audio",
      url: "/assets/donation.mp3",
      accountId: "account-2",
      size: 256000,
      createdAt: "2024-09-01T00:00:00Z",
    },
    {
      id: "asset-11",
      name: "Starting Soon",
      type: "video",
      url: "/assets/starting.mp4",
      accountId: "account-1",
      size: 3072000,
      createdAt: "2024-10-01T00:00:00Z",
    },
    {
      id: "asset-12",
      name: "Ending Screen",
      type: "image",
      url: "/assets/ending.png",
      accountId: "account-1",
      size: 256000,
      createdAt: "2024-11-01T00:00:00Z",
    },
  ];

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

  protected streamEvents: Array<{
    id: string;
    accountId: string;
    type: string;
    user: string;
    amount?: number;
    message?: string;
    timestamp: string;
  }> = [
    { id: "evt-1", accountId: "account-1", type: "follow", user: "NewFollower123", timestamp: "2026-01-14T05:25:00Z" },
    {
      id: "evt-2",
      accountId: "account-1",
      type: "subscription",
      user: "LoyalSub",
      amount: 1,
      message: "Love the stream!",
      timestamp: "2026-01-14T05:20:00Z",
    },
    {
      id: "evt-3",
      accountId: "account-1",
      type: "cheer",
      user: "BitGiver",
      amount: 500,
      message: "Take my bits!",
      timestamp: "2026-01-14T05:15:00Z",
    },
    {
      id: "evt-4",
      accountId: "account-1",
      type: "raid",
      user: "FriendlyStreamer",
      amount: 42,
      timestamp: "2026-01-14T05:10:00Z",
    },
    {
      id: "evt-5",
      accountId: "account-1",
      type: "gift",
      user: "GiftMaster",
      amount: 5,
      message: "Gifting to the community!",
      timestamp: "2026-01-14T05:05:00Z",
    },
    {
      id: "evt-6",
      accountId: "account-1",
      type: "donation",
      user: "GenerousDonor",
      amount: 25,
      message: "Keep up the great work!",
      timestamp: "2026-01-14T05:00:00Z",
    },
    { id: "evt-7", accountId: "account-1", type: "follow", user: "AnotherFan", timestamp: "2026-01-14T04:55:00Z" },
    {
      id: "evt-8",
      accountId: "account-1",
      type: "subscription",
      user: "TierThreeSub",
      amount: 3,
      message: "Tier 3 hype!",
      timestamp: "2026-01-14T04:50:00Z",
    },
    { id: "evt-9", accountId: "account-2", type: "follow", user: "YTFollower", timestamp: "2026-01-14T04:45:00Z" },
    {
      id: "evt-10",
      accountId: "account-2",
      type: "donation",
      user: "SuperChat",
      amount: 10,
      message: "Great content!",
      timestamp: "2026-01-14T04:40:00Z",
    },
  ];

  protected triggers: Array<{
    id: string;
    moduleId: string;
    name: string;
    description: string;
    icon: string;
    category: string;
    color?: string;
    config: {
      fields: Array<{
        id: string;
        name: string;
        type: string;
        label: string;
        description?: string;
        required?: boolean;
        placeholder?: string;
        defaultValue?: unknown;
        options?: Array<{ label: string; value: string }>;
        min?: number;
        max?: number;
        step?: number;
        unit?: string;
        mediaType?: string;
        validation?: { pattern?: string; message?: string };
      }>;
      supportsTiers?: boolean;
      tierLabel?: string;
    };
  }> = [
    // "trigger-chat-command" used to live here as mock scaffolding, only
    // reachable via the singular getTrigger(id) below (never the plural
    // getTriggers(), which is what the real trigger-picker uses). It's been
    // retired now that a real "Chat Command" trigger is registered for real
    // via woofwoofwoof's SYSTEM registerTriggers call on startup
    // (createdByType "SYSTEM", createdByRef "chat_commands", manifestId
    // "chat_command") and round-trips through db.listTriggers().
    {
      id: "trigger-follow",
      moduleId: "mod-2",
      name: "New Follower",
      description: "When someone follows the channel",
      icon: "UserPlus",
      category: "events",
      color: "text-green-500",
      config: { fields: [] },
    },
    {
      id: "trigger-subscription",
      moduleId: "mod-2",
      name: "Subscription",
      description: "When someone subscribes or resubscribes",
      icon: "Star",
      category: "events",
      color: "text-purple-500",
      config: {
        fields: [
          {
            id: "minMonths",
            name: "minMonths",
            type: "number",
            label: "Minimum Months",
            min: 0,
            max: 100,
            defaultValue: 0,
          },
        ],
        supportsTiers: true,
        tierLabel: "Subscription Tier",
      },
    },
    {
      id: "trigger-cheer",
      moduleId: "mod-2",
      name: "Cheer/Bits",
      description: "When someone cheers with bits",
      icon: "Gem",
      category: "events",
      color: "text-pink-500",
      config: {
        fields: [
          {
            id: "minBits",
            name: "minBits",
            type: "number",
            label: "Minimum Bits",
            min: 1,
            max: 100000,
            defaultValue: 1,
          },
        ],
      },
    },
    {
      id: "trigger-raid",
      moduleId: "mod-2",
      name: "Raid",
      description: "When another streamer raids the channel",
      icon: "Users",
      category: "events",
      color: "text-orange-500",
      config: {
        fields: [
          {
            id: "minViewers",
            name: "minViewers",
            type: "number",
            label: "Minimum Viewers",
            min: 0,
            max: 10000,
            defaultValue: 0,
          },
        ],
      },
    },
    {
      id: "trigger-redemption",
      moduleId: "mod-3",
      name: "Channel Point Redemption",
      description: "When someone redeems channel points",
      icon: "Gift",
      category: "engagement",
      color: "text-cyan-500",
      config: {
        fields: [
          {
            id: "rewardId",
            name: "rewardId",
            type: "string",
            label: "Reward ID",
            placeholder: "Leave empty for any reward",
          },
        ],
      },
    },
    {
      id: "trigger-stream-online",
      moduleId: "mod-8",
      name: "Stream Goes Live",
      description: "When the stream starts",
      icon: "Radio",
      category: "stream",
      color: "text-red-500",
      config: { fields: [] },
    },
    {
      id: "trigger-stream-offline",
      moduleId: "mod-8",
      name: "Stream Goes Offline",
      description: "When the stream ends",
      icon: "RadioOff",
      category: "stream",
      color: "text-gray-500",
      config: { fields: [] },
    },
  ];

  protected userPreferences = { email: true, push: false, workflow: true, marketing: false };

  protected dashboardLayouts: Record<
    string,
    Array<{
      id: string;
      type: string;
      title: string;
      config?: Record<string, unknown>;
    }>
  > = {
    "account-1": [
      { id: "dash-1", type: "chat", title: "Live Chat", config: { accountId: "account-1" } },
      { id: "dash-2", type: "workflow-runs", title: "Recent Workflows", config: { accountId: "account-1", limit: 5 } },
      { id: "dash-3", type: "event-feed", title: "Stream Events", config: { accountId: "account-1", limit: 10 } },
    ],
  };

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
    this.logger = opts.logger;
  }
}
