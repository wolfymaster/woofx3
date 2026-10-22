import type { EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import type { Context } from "src/types";
import onChannelAdBreakBegin, { AdBreakAnnouncer } from "./subscriptions/onChannelAdBreakBegin";
import onChannelBan from "./subscriptions/onChannelBan";
import onChannelChatmessage from "./subscriptions/onChannelChatMessage";
import onChannelChatNotification from "./subscriptions/onChannelChatNotification";
import onChannelCheer from "./subscriptions/onChannelCheer";
import onChannelFollow from "./subscriptions/onChannelFollow";
import onChannelHypeTrainBegin from "./subscriptions/onChannelHypeTrainBegin";
import onChannelRaid from "./subscriptions/onChannelRaid";
import onChannelRedemptionAdd from "./subscriptions/onChannelRedemptionAdd";
import onStreamOffline from "./subscriptions/onStreamOffline";
import onStreamOnline from "./subscriptions/onStreamOnline";

/**
 * Every subscription this service needs. Kept as data so the expected
 * count is known before any of them is created — readiness is "Twitch
 * confirmed all of these", which cannot be judged without it.
 */
const SUBSCRIPTION_FACTORIES = [
  onChannelBan,
  onChannelChatmessage,
  onChannelChatNotification,
  onChannelCheer,
  onChannelFollow,
  onChannelHypeTrainBegin,
  onChannelRaid,
  onChannelRedemptionAdd,
  onStreamOnline,
  onStreamOffline,
] as const;

/** State an optional subscription keeps across resubscribes. */
interface OptionalSubscriptionDeps {
  adBreaks: AdBreakAnnouncer;
}

type OptionalSubscriptionFactory = (
  ctx: Context,
  listener: EventSubWsListener,
  deps: OptionalSubscriptionDeps
) => EventSubSubscription;

interface OptionalSubscription {
  name: string;
  scope: string;
  factory: OptionalSubscriptionFactory;
}

/**
 * Subscriptions that need a scope the streamer may not have granted. They
 * are attempted, but a refusal only costs the events they carry, so they are
 * left out of readiness: a service that reports unready over a missing
 * optional scope would be restarted forever for something only a reconnect
 * in the UI can fix.
 */
const OPTIONAL_SUBSCRIPTIONS: readonly OptionalSubscription[] = [
  {
    name: "channel.ad_break.begin",
    scope: "channel:read:ads",
    factory: (ctx, listener, deps) => onChannelAdBreakBegin(ctx, listener, deps.adBreaks),
  },
];

/**
 * How long boot waits for Twitch to confirm the subscriptions before
 * giving up and reporting what it has. Confirmations only start arriving
 * after `session_welcome`, so this must comfortably exceed connect time.
 */
export const SUBSCRIPTION_SETTLE_TIMEOUT_MS = 20_000;

export interface SubscriptionFailure {
  id: string;
  reason: string;
}

export default class TwitchEventBus {
  private subscriptions: EventSubSubscription[];
  private readonly established = new Set<string>();
  private readonly failures = new Map<string, string>();
  private readonly optionalById = new Map<string, OptionalSubscription>();
  private readonly optionalWarned = new Set<string>();
  private bindings: { unbind(): void }[] = [];
  private readonly optionalDeps: OptionalSubscriptionDeps;

  constructor(
    private ctx: Context,
    private listener: EventSubWsListener
  ) {
    this.subscriptions = [];
    this.listener = listener;
    this.optionalDeps = { adBreaks: new AdBreakAnnouncer(ctx) };
  }

  /**
   * True only when Twitch has confirmed every subscription. A listener
   * whose subscriptions were refused (e.g. HTTP 429 "number of websocket
   * transports limit exceeded") stays connected and silent — it receives
   * no events at all — so this is what health must be gated on rather
   * than on the socket being open.
   *
   * Stays live after boot: Twurple retries refused subscriptions, so a
   * bus that starts unhealthy flips to healthy on its own once the
   * retries land, with no restart needed.
   */
  isReady(): boolean {
    return this.failedSubscriptions().length === 0 && this.establishedCount() === SUBSCRIPTION_FACTORIES.length;
  }

  /** Required subscriptions Twitch has refused, for logging and diagnostics. */
  failedSubscriptions(): SubscriptionFailure[] {
    return [...this.failures].filter(([id]) => !this.optionalById.has(id)).map(([id, reason]) => ({ id, reason }));
  }

  /** Count of required subscriptions Twitch has confirmed, out of the expected total. */
  establishedCount(): number {
    return [...this.established].filter((id) => !this.optionalById.has(id)).length;
  }

  /** Total subscriptions this bus expects to establish. */
  static get expectedSubscriptionCount(): number {
    return SUBSCRIPTION_FACTORIES.length;
  }

  /**
   * Start the EventSub WebSocket listener and register channel handlers.
   * Subscriptions activate when Twitch sends session_welcome (Twurple calls
   * subscription.start internally). Do not call subscription.start() during boot.
   */
  async start(timeoutMs: number = SUBSCRIPTION_SETTLE_TIMEOUT_MS): Promise<void> {
    this.unbindOutcomes();
    this.established.clear();
    this.failures.clear();
    this.optionalWarned.clear();
    // Bind before creating anything: a confirmation that arrives while
    // no handler is attached is lost, and readiness would never settle.
    const settled = this.trackSubscriptionOutcomes(timeoutMs);
    this.listener.start();
    this.registerSubscriptions();
    await settled;
  }

  /**
   * Recreate every subscription on the running listener, so each is
   * requested again with whatever token the auth provider now holds. Used
   * after the streamer relinks Twitch: a relink is how a scope gets granted,
   * and an optional subscription refused for that scope is only retried by
   * asking again. Readiness drops only for as long as Twitch takes to
   * confirm the new batch.
   */
  async resubscribe(timeoutMs: number = SUBSCRIPTION_SETTLE_TIMEOUT_MS): Promise<void> {
    this.unbindOutcomes();
    this.established.clear();
    this.failures.clear();
    this.optionalWarned.clear();
    const settled = this.trackSubscriptionOutcomes(timeoutMs);
    this.registerSubscriptions();
    await settled;
  }

  private unbindOutcomes(): void {
    for (const binding of this.bindings) {
      binding.unbind();
    }
    this.bindings = [];
  }

  /**
   * Resolves once every subscription has been confirmed or refused, or
   * once `timeoutMs` elapses — whichever comes first. The event handlers
   * stay bound afterwards so later retries keep `isReady()` current.
   */
  private trackSubscriptionOutcomes(timeoutMs: number): Promise<void> {
    const expected = SUBSCRIPTION_FACTORIES.length;
    return new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      // Optional subscriptions are recorded like any other and filtered out
      // when read: an outcome can arrive before the factory that created the
      // subscription has returned, so its id may not be known as optional yet.
      const settledCount = () => this.establishedCount() + this.failedSubscriptions().length;

      this.bindings.push(
        this.listener.onSubscriptionCreateSuccess((subscription) => {
          this.optionalWarned.delete(subscription.id);
          this.failures.delete(subscription.id);
          this.established.add(subscription.id);
          if (settledCount() >= expected) {
            finish();
          }
        })
      );
      this.bindings.push(
        this.listener.onSubscriptionCreateFailure((subscription, error) => {
          this.established.delete(subscription.id);
          this.failures.set(subscription.id, error.message);
          const optional = this.optionalById.get(subscription.id);
          if (optional) {
            this.warnOptionalRefused(subscription.id, optional, error);
            return;
          }
          if (settledCount() >= expected) {
            finish();
          }
        })
      );
    });
  }

  /**
   * Twurple retries a refused subscription, and a missing scope is refused
   * on every retry, so this warns once per subscription per start rather
   * than once per attempt.
   */
  private warnOptionalRefused(id: string, optional: OptionalSubscription, error: Error): void {
    if (this.optionalWarned.has(id)) {
      return;
    }
    this.optionalWarned.add(id);
    this.ctx.logger.warn(
      `twitch: optional subscription ${optional.name} refused; its events will not be published. If the reason is a missing scope, reconnect Twitch to grant ${optional.scope}.`,
      { subscription: optional.name, scope: optional.scope, reason: error.message }
    );
  }

  disconnect(): void {
    this.unbindOutcomes();
    this.optionalDeps.adBreaks.dispose();
    this.established.clear();
    this.failures.clear();
    this.clearSubscriptions();
    this.listener.stop();
  }

  private registerSubscriptions(): void {
    this.clearSubscriptions();

    for (const f of SUBSCRIPTION_FACTORIES) {
      this.subscriptions.push(f(this.ctx, this.listener));
    }
    for (const optional of OPTIONAL_SUBSCRIPTIONS) {
      const subscription = optional.factory(this.ctx, this.listener, this.optionalDeps);
      this.optionalById.set(subscription.id, optional);
      this.subscriptions.push(subscription);
    }
  }

  private clearSubscriptions(): void {
    for (const sub of this.subscriptions) {
      sub.stop();
    }
    this.subscriptions = [];
    this.optionalById.clear();
  }

  /** Re-activate subscriptions after a manual stop(). Not used during initial boot. */
  resumeSubscriptions(): void {
    for (const sub of this.subscriptions) {
      sub.start();
    }
  }

  stopSubscriptions(): void {
    for (const sub of this.subscriptions) {
      sub.stop();
    }
  }
}
