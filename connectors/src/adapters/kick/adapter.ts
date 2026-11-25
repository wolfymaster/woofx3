import { KICKAPI_SERVED_BUDGET_MS, KICKAPI_SUBJECT } from "@woofx3/common/cloudevents/Kick/commands";
import { KICK_TOKEN_SUBJECT } from "@woofx3/common/cloudevents/Kick/token";
import {
  KICK_WEBHOOK_SERVED_BUDGET_MS,
  KICK_WEBHOOK_SUBJECT,
  kickWebhookReply,
} from "@woofx3/common/cloudevents/Kick/webhook";
import { encodePlatformApiError } from "@woofx3/common/cloudevents/PlatformApi/reply";
import { EventType } from "@woofx3/common/cloudevents/Twitch/events";
import { INTEGRATION_TOKEN_UPDATED_SUBJECT } from "@woofx3/common/integrations/integration-settings";
import { BoundedMap } from "../../chat/bounded-map";
import type { KickConfig } from "../../config/kick";
import type { Adapter, AdapterContext, AdapterManifest, AdapterModule, Unavailable } from "../../host/adapter";
import type { Clock, IdSource, RandomSource, Timers } from "../../host/deps";
import type { LinkState } from "../../host/link-readers";
import { SelfSentRegistry } from "../shared/self-sent";
import { SendQueue } from "../shared/send-queue";
import KickApplication from "./application";
import { type KickEgressSession, kickEgress } from "./egress";
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
  deliveries: DeliveryMemory;
  redemptionsSeen: BoundedMap<string, true>;
}

export interface KickAdapterDeps {
  config: KickConfig;
  clock: Clock;
  fetch: typeof fetch;
  timers: Timers;
  random: RandomSource;
  ids: IdSource;
}

const encoder = new TextEncoder();

/** Why the host is answering `kickapi` for a stopped adapter, in words a streamer can act on. */
const UNAVAILABLE_MESSAGES: Record<Unavailable["reason"], string> = {
  stopped: "Kick is turned off or not running in this engine",
  starting: "Kick is turned off or not running in this engine: it is still connecting, try again shortly",
  parked:
    "Kick is turned off or not running in this engine: it failed repeatedly and waits until Kick is relinked or re-enabled",
};

/**
 * The `kickapi` reply while the adapter cannot answer: `not_linked` when no
 * account is linked, else `integration_unavailable`. A link not read yet
 * counts as linked, because nothing says the streamer has to link.
 */
export function kickApiUnavailableReply(
  unavailable: Unavailable,
  deps: Pick<KickAdapterDeps, "clock" | "ids">
): Uint8Array {
  if (unavailable.link !== null && !unavailable.link.connected) {
    return encodePlatformApiError(
      KICKAPI_SUBJECT,
      "Kick is not linked yet: the streamer has to connect Kick first",
      "not_linked",
      deps
    );
  }
  return encodePlatformApiError(
    KICKAPI_SUBJECT,
    UNAVAILABLE_MESSAGES[unavailable.reason],
    "integration_unavailable",
    deps
  );
}

/**
 * Kick as a host adapter: runs while Kick is linked and enabled, and turns
 * the webhook deliveries the api hands it on `engine.kick.webhook` into bus
 * events, and performs the platform gateway's chat and moderation actions.
 * Each start builds a fresh KickApplication, so nothing from an
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
    const queue = new SendQueue(deps.config.sendQueueCap);
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
        {
          subject: KICKAPI_SUBJECT,
          budgetMs: KICKAPI_SERVED_BUDGET_MS,
          handle: (request) => this.answerKickApi(request),
          unavailableReply: (unavailable) => kickApiUnavailableReply(unavailable, deps),
        },
      ],
      egress: kickEgress({ session: () => this.egressSession(), queue, selfSent: this.selfSent }),
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
      deliveriesRemembered: this.hostState.deliveries.delivered.size,
      ownLinesAwaitingEcho: this.selfSent.size,
    };
  }

  /**
   * The running connection for egress. The gateway only hands a request over
   * while the adapter is connected; a write waiting in the queue can still
   * find it stopped.
   */
  private egressSession(): KickEgressSession {
    const run = this.run;
    if (run === undefined) {
      return { kind: "unavailable", reason: "stopped" };
    }
    const broadcaster = run.broadcaster;
    if (broadcaster === undefined) {
      return { kind: "unavailable", reason: "starting" };
    }
    return { kind: "ready", broadcasterUserId: broadcaster.userId, api: run.api };
  }

  private async answerKickApi(request: Uint8Array): Promise<Uint8Array> {
    const run = this.run;
    if (run === undefined) {
      throw new Error("kickapi reached the kick adapter while it is not running");
    }
    return run.answerKickApi(request);
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
    deliveries: {
      delivered: new BoundedMap({ capacity: deps.config.dedupe.capacity, ttlMs: deps.config.dedupe.ttlMs }, deps.clock),
      published: new BoundedMap({ capacity: deps.config.dedupe.capacity, ttlMs: deps.config.dedupe.ttlMs }, deps.clock),
      inFlight: new Map(),
    },
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
