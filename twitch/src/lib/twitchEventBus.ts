import type { EventSubSubscription } from "@twurple/eventsub-base";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import type { Context } from "src/types";
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
  private bindings: { unbind(): void }[] = [];

  constructor(
    private ctx: Context,
    private listener: EventSubWsListener
  ) {
    this.subscriptions = [];
    this.listener = listener;
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
    return this.failures.size === 0 && this.established.size === SUBSCRIPTION_FACTORIES.length;
  }

  /** Subscriptions Twitch has refused, for logging and diagnostics. */
  failedSubscriptions(): SubscriptionFailure[] {
    return [...this.failures].map(([id, reason]) => ({ id, reason }));
  }

  /** Count of subscriptions Twitch has confirmed, out of the expected total. */
  establishedCount(): number {
    return this.established.size;
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
    this.established.clear();
    this.failures.clear();
    // Bind before creating anything: a confirmation that arrives while
    // no handler is attached is lost, and readiness would never settle.
    const settled = this.trackSubscriptionOutcomes(timeoutMs);
    this.listener.start();
    this.registerSubscriptions();
    await settled;
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
      const settledCount = () => this.established.size + this.failures.size;

      this.bindings.push(
        this.listener.onSubscriptionCreateSuccess((subscription) => {
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
          if (settledCount() >= expected) {
            finish();
          }
        })
      );
    });
  }

  disconnect(): void {
    for (const binding of this.bindings) {
      binding.unbind();
    }
    this.bindings = [];
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
  }

  private clearSubscriptions(): void {
    for (const sub of this.subscriptions) {
      sub.stop();
    }
    this.subscriptions = [];
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
