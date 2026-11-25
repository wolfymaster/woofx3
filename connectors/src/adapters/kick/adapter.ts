import { KICK_TOKEN_SUBJECT } from "@woofx3/common/cloudevents/Kick/token";
import {
  KICK_WEBHOOK_SERVED_BUDGET_MS,
  KICK_WEBHOOK_SUBJECT,
  kickWebhookReply,
} from "@woofx3/common/cloudevents/Kick/webhook";
import { EventType } from "@woofx3/common/cloudevents/Twitch/events";
import { INTEGRATION_TOKEN_UPDATED_SUBJECT } from "@woofx3/common/integrations/integration-settings";
import { BoundedMap } from "../../chat/bounded-map";
import type { KickConfig } from "../../config/kick";
import type { Adapter, AdapterContext, AdapterManifest, AdapterModule } from "../../host/adapter";
import type { Clock, RandomSource, Timers } from "../../host/deps";
import type { LinkState } from "../../host/link-readers";
import { SelfSentRegistry } from "../shared/self-sent";
import KickApplication from "./application";
import type { DeliveryMemory } from "./ingest";

/** Every subject the adapter publishes: the woofx3 events Kick deliveries become. */
export const KICK_EVENT_SUBJECTS: readonly string[] = [
  EventType.ChatMessage,
  EventType.Follow,
  EventType.Subscribe,
  EventType.Resub,
  EventType.SubscriptionGift,
  EventType.Redeem,
  EventType.StreamOnline,
  EventType.StreamOffline,
  EventType.Kicks,
];

/**
 * What outlives every run of the adapter: the deliveries already published,
 * so Kick's retry of one that straddled a restart publishes nothing, and the
 * redemptions already published, so their later status updates publish
 * nothing. Both are lost on a process restart.
 */
export interface KickHostState {
  delivered: DeliveryMemory;
  redemptionsSeen: BoundedMap<string, true>;
}

export interface KickAdapterDeps {
  config: KickConfig;
  clock: Clock;
  fetch: typeof fetch;
  timers: Timers;
  random: RandomSource;
}

const encoder = new TextEncoder();

/**
 * Kick as a host adapter: runs while Kick is linked and enabled, and turns
 * the webhook deliveries the api hands it on `engine.kick.webhook` into bus
 * events. Each start builds a fresh KickApplication, so nothing from an
 * earlier run leaks into the next one. The record of the engine's own chat
 * lines lives as long as the adapter, so a line said before a restart is
 * still known when its echo arrives after it.
 */
export class KickAdapter implements Adapter<KickHostState> {
  readonly manifest: AdapterManifest<KickHostState>;
  private run: KickApplication | undefined;
  private readonly selfSent: SelfSentRegistry;

  constructor(
    private readonly deps: KickAdapterDeps,
    private readonly hostState: KickHostState
  ) {
    this.selfSent = new SelfSentRegistry(deps.config.selfSent, deps.clock);
    this.manifest = {
      id: "kick",
      publishes: KICK_EVENT_SUBJECTS,
      subscribes: [INTEGRATION_TOKEN_UPDATED_SUBJECT],
      requests: [KICK_TOKEN_SUBJECT],
      serves: [
        {
          subject: KICK_WEBHOOK_SUBJECT,
          budgetMs: KICK_WEBHOOK_SERVED_BUDGET_MS,
          handle: (request) => this.ingest(request),
          unavailableReply: () => encoder.encode(JSON.stringify(kickWebhookReply("unavailable"))),
        },
      ],
    };
  }

  desired(link: LinkState): boolean {
    return link.connected && link.enabled;
  }

  async start(ctx: AdapterContext, signal: AbortSignal): Promise<void> {
    if (this.run !== undefined) {
      throw new Error("the kick adapter is already running; the host never starts it twice");
    }
    const run = new KickApplication({ ...this.deps, hostState: this.hostState, selfSent: this.selfSent }, ctx);
    this.run = run;
    await run.start(signal);
  }

  async stop(): Promise<void> {
    const run = this.run;
    this.run = undefined;
    await run?.stop();
  }

  detail(): Record<string, unknown> {
    const broadcaster = this.run?.broadcaster;
    return {
      broadcasterId: broadcaster?.userId ?? null,
      slug: broadcaster?.slug ?? null,
      subscriptions: this.run?.subscriptions() ?? null,
      deliveriesRemembered: this.hostState.delivered.size,
      ownLinesAwaitingEcho: this.selfSent.size,
    };
  }

  private async ingest(request: Uint8Array): Promise<Uint8Array> {
    const run = this.run;
    if (run === undefined) {
      throw new Error("engine.kick.webhook reached the kick adapter while it is not running");
    }
    return encoder.encode(JSON.stringify(await run.ingest(request)));
  }
}

export function kickHostState(deps: Pick<KickAdapterDeps, "config" | "clock">): KickHostState {
  return {
    delivered: new BoundedMap({ capacity: deps.config.dedupe.capacity, ttlMs: deps.config.dedupe.ttlMs }, deps.clock),
    redemptionsSeen: new BoundedMap(
      { capacity: deps.config.redemptionSeen.capacity, ttlMs: deps.config.redemptionSeen.ttlMs },
      deps.clock
    ),
  };
}

/** The registry entry's module: one adapter for the life of the process, with its delivery memory. */
export function kickAdapterModule(deps: KickAdapterDeps): AdapterModule<KickHostState> {
  return { hostState: () => kickHostState(deps), create: (hostState) => new KickAdapter(deps, hostState) };
}
