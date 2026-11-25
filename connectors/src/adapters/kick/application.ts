import EventFactory from "@woofx3/common/cloudevents/EventFactory";
import type { KickWebhookReply } from "@woofx3/common/cloudevents/Kick/webhook";
import { INTEGRATION_TOKEN_UPDATED_SUBJECT } from "@woofx3/common/integrations/integration-settings";
import type { KickConfig } from "../../config/kick";
import type { AdapterContext } from "../../host/adapter";
import {
  type Clock,
  errorMessage,
  type IdSource,
  type RandomSource,
  type TimerHandle,
  type Timers,
} from "../../host/deps";
import type { BusMessage } from "../../host/scoped-bus";
import type { SelfSentRegistry } from "../shared/self-sent";
import type { KickHostState } from "./adapter";
import { answerKickApiRequest } from "./commands";
import { KICK_EVENT_SOURCE } from "./event-source";
import { ingestKickDelivery } from "./ingest";
import { describeKickFailure, KickApi, type KickApiFailure, type KickChannel } from "./lib/kick-api";
import { KickSignatureVerifier } from "./lib/signature";
import { SubscriptionReconciler } from "./lib/subscriptions";
import { KickTokenClient } from "./lib/token";

/** The linked Kick channel, fixed for one run. */
export interface KickBroadcaster {
  userId: string;
  slug: string;
  name: string;
}

export interface KickApplicationDeps {
  config: KickConfig;
  clock: Clock;
  fetch: typeof fetch;
  hostState: KickHostState;
  selfSent: SelfSentRegistry;
  timers: Timers;
  random: RandomSource;
  ids: IdSource;
}

/**
 * One run of the Kick adapter: from a start to its stop, with the token, the
 * REST client and the broadcaster it found. Every call it makes is aborted
 * when the run stops, so nothing from one run outlives it.
 */
export default class KickApplication {
  private readonly lifetime = new AbortController();
  private readonly tokens: KickTokenClient;
  readonly api: KickApi;
  private linked: { broadcaster: KickBroadcaster } | undefined;
  private readonly verifier: KickSignatureVerifier;
  private readonly reconciler: SubscriptionReconciler;
  /** The live state last published, from the start's read, a webhook or a live check; null before the first. */
  private believedLive: boolean | null = null;
  private liveCheck: TimerHandle | undefined;
  /** Badge types already logged as unknown, so each shows once per run. */
  private readonly unknownBadges = new Set<string>();

  constructor(
    private readonly deps: KickApplicationDeps,
    private readonly ctx: AdapterContext
  ) {
    this.tokens = new KickTokenClient({
      request: (subject, data, opts) => ctx.bus.request(subject, data, opts),
      clock: deps.clock,
      timeoutMs: deps.config.tokenRequestTimeoutMs,
      expiryMarginMs: deps.config.tokenExpiryMarginMs,
    });
    this.api = new KickApi({
      fetch: deps.fetch,
      token: this.tokens,
      clock: deps.clock,
      baseUrl: deps.config.apiBaseUrl,
      timeoutMs: deps.config.requestTimeoutMs,
      tokenTimeoutMs: deps.config.tokenRequestTimeoutMs,
      userAgent: deps.config.userAgent,
      signal: this.lifetime.signal,
    });
    this.reconciler = new SubscriptionReconciler({
      api: this.api,
      timers: deps.timers,
      random: deps.random,
      logger: ctx.logger,
      config: { intervalMs: deps.config.subscriptionReconcileIntervalMs, backoff: deps.config.reconcileBackoff },
    });
    this.verifier = new KickSignatureVerifier({
      api: this.api,
      clock: deps.clock,
      publicKeyRefetchMinIntervalMs: deps.config.publicKeyRefetchMinIntervalMs,
    });
  }

  get broadcaster(): KickBroadcaster | undefined {
    return this.linked?.broadcaster;
  }

  /**
   * Finds the linked broadcaster and seeds the stream's live state. Rejects
   * when no Kick account is linked after all or Kick could not be asked, so
   * the host marks the adapter degraded and retries with backoff.
   */
  async start(signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      this.lifetime.abort(signal.reason);
    } else {
      signal.addEventListener("abort", () => this.lifetime.abort(signal.reason), { once: true });
    }
    await this.ctx.bus.subscribe(INTEGRATION_TOKEN_UPDATED_SUBJECT, (msg) => this.onTokenUpdated(msg));
    this.linked = { broadcaster: await this.findBroadcaster() };
    await this.ctx.liveStatus.seed(async () => {
      const status = await this.readLive();
      this.believedLive = status.live;
      return status;
    }, this.lifetime.signal);
    // A subscription Kick refuses (a missing scope) leaves the run connected:
    // its REST actions still work, and /health shows the refusal.
    await this.reconciler.start();
    this.liveCheck = this.deps.timers.setInterval(() => {
      void this.checkLive();
    }, this.deps.config.liveCheckIntervalMs);
  }

  /**
   * Publishes the going-live or going-offline Kick's webhook did not deliver,
   * as the webhook would have, when the channel's state differs from the one
   * last published.
   */
  private async checkLive(): Promise<void> {
    const broadcaster = this.linked?.broadcaster;
    if (broadcaster === undefined || this.believedLive === null) {
      return;
    }
    let status: { live: boolean; startedAt?: string };
    try {
      status = await this.readLive();
    } catch (err) {
      this.ctx.logger.debug("kick: could not read the channel's live state; trying again later", {
        err: errorMessage(err),
      });
      return;
    }
    if (this.lifetime.signal.aborted || status.live === this.believedLive) {
      return;
    }
    const events = new EventFactory({ source: KICK_EVENT_SOURCE }).Platform("kick");
    const who = { broadcasterUserId: broadcaster.userId, broadcasterUserName: broadcaster.name };
    const [subject, data] = status.live
      ? events.streamOnline({ ...who, startedAt: status.startedAt ?? new Date(this.deps.clock.now()).toISOString() })
      : events.streamOffline(who);
    try {
      await this.ctx.bus.publish(subject, data);
    } catch (err) {
      this.ctx.logger.warn("kick: could not publish a live state change the webhook missed", {
        subject,
        err: errorMessage(err),
      });
      return;
    }
    this.ctx.logger.info("kick: published a live state change the webhook missed", { subject });
    this.believedLive = status.live;
    this.ctx.liveStatus.changed(status);
  }

  /** Per subscribed event, for /health. */
  subscriptions(): ReturnType<SubscriptionReconciler["detail"]> {
    return this.reconciler.detail();
  }

  /** One `kickapi` request; the host only hands it over while the run is connected. */
  async answerKickApi(request: Uint8Array, deadline: number): Promise<Uint8Array> {
    const linked = this.linked;
    if (linked === undefined) {
      throw new Error("a kickapi request reached the run before it found its broadcaster");
    }
    return answerKickApiRequest(
      request,
      { api: this.api, broadcaster: linked.broadcaster },
      { clock: this.deps.clock, ids: this.deps.ids, logger: this.ctx.logger },
      deadline
    );
  }

  /** One webhook delivery from `engine.kick.webhook`; the host only hands it over while the run is connected. */
  async ingest(request: Uint8Array): Promise<KickWebhookReply> {
    const linked = this.linked;
    if (linked === undefined) {
      throw new Error("a Kick delivery reached the run before it found its broadcaster");
    }
    const { hostState, selfSent } = this.deps;
    return ingestKickDelivery(request, {
      verify: (delivery) => this.verifier.verify(delivery),
      clock: this.deps.clock,
      logger: this.ctx.logger,
      maxSkewMs: this.deps.config.webhookMaxSkewMs,
      memory: hostState.deliveries,
      eventsFor: (deliveryId) => {
        let index = 0;
        return new EventFactory({ source: KICK_EVENT_SOURCE }).Platform("kick", () => `${deliveryId}:${index++}`);
      },
      broadcasterUserId: linked.broadcaster.userId,
      normalise: {
        claimOwnLine: (echo) => selfSent.claimEcho(echo),
        redemptionPublished: (redemptionId) => hostState.redemptionsSeen.get(redemptionId) !== undefined,
        unknownBadge: (type) => {
          if (!this.unknownBadges.has(type)) {
            this.unknownBadges.add(type);
            this.ctx.logger.info("kick: a chat badge type sets no membership", { type });
          }
        },
      },
      publish: (subject, data) => this.ctx.bus.publish(subject, data),
      liveChanged: (status) => {
        this.believedLive = status.live;
        this.ctx.liveStatus.changed(status);
      },
      redemptionPublished: (redemptionId) => hostState.redemptionsSeen.set(redemptionId, true),
    });
  }

  async stop(): Promise<void> {
    if (this.liveCheck !== undefined) {
      this.deps.timers.clearInterval(this.liveCheck);
      this.liveCheck = undefined;
    }
    this.lifetime.abort(new Error("the Kick adapter stopped"));
    await this.reconciler.stop();
  }

  private async findBroadcaster(): Promise<KickBroadcaster> {
    const user = await this.api.self();
    if (!user.ok) {
      throw startFailure("read the linked Kick user", user.error);
    }
    const channel = await this.ownChannel();
    if (channel.broadcasterUserId !== user.value.userId) {
      throw new Error(
        `Kick answered channel ${channel.broadcasterUserId} for user ${user.value.userId}; the link is inconsistent`
      );
    }
    return { userId: user.value.userId, slug: channel.slug, name: user.value.name };
  }

  private async ownChannel(): Promise<KickChannel> {
    const channels = await this.api.channels("self");
    if (!channels.ok) {
      throw startFailure("read the linked Kick channel", channels.error);
    }
    const channel = channels.value[0];
    if (channel === undefined) {
      throw new Error("Kick has no channel for the linked user");
    }
    return channel;
  }

  private async readLive(): Promise<{ live: boolean; startedAt?: string }> {
    const channel = await this.ownChannel();
    const startedAt = channel.stream.startedAt;
    if (!channel.stream.isLive) {
      return { live: false };
    }
    const started = startedAt === null ? Number.NaN : Date.parse(startedAt);
    return Number.isNaN(started) ? { live: true } : { live: true, startedAt: new Date(started).toISOString() };
  }

  /**
   * A relink: the next call asks the api for the new token. The same
   * broadcaster keeps the run; another one is a different channel, so the
   * host restarts the run around it.
   */
  private async onTokenUpdated(msg: BusMessage): Promise<void> {
    if (integrationOf(msg) !== "kick") {
      return;
    }
    this.tokens.forget();
    const before = this.linked?.broadcaster;
    const user = await this.api.self();
    if (this.lifetime.signal.aborted) {
      return;
    }
    if (!user.ok) {
      this.ctx.logger.warn("kick: could not read the relinked Kick user", { err: describeKickFailure(user.error) });
      return;
    }
    if (before !== undefined && user.value.userId !== before.userId) {
      this.ctx.reportFault(`Kick was relinked to another channel (${user.value.userId})`);
      return;
    }
    // The same channel, perhaps with other scopes: subscribe to what they now allow.
    await this.reconciler.reconcileNow();
  }
}

function integrationOf(msg: BusMessage): unknown {
  try {
    const event = JSON.parse(new TextDecoder().decode(msg.data)) as { data?: { integration?: unknown } } | null;
    return event?.data?.integration;
  } catch {
    // Not a CloudEvent: it names no integration, so it is not Kick's.
    return undefined;
  }
}

function startFailure(doing: string, failure: KickApiFailure): Error {
  if (failure.kind === "not_linked") {
    return new Error("Kick is not linked: no Kick token is stored, or it has to be linked again");
  }
  return new Error(`could not ${doing}: ${describeKickFailure(failure)}`);
}
