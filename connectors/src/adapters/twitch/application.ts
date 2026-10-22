import type { ApiClient, HelixUser } from "@twurple/api";
import type { AuthProvider } from "@twurple/auth";
import EventFactory from "@woofx3/common/cloudevents/EventFactory";
import { HELIX_COMMAND, TWITCHAPI_SUBJECT } from "@woofx3/common/cloudevents/Twitch/commands";
import { INTEGRATION_TOKEN_UPDATED_SUBJECT } from "@woofx3/common/integrations/integration-settings";
import { type Span, SpanKind, withSpan } from "@woofx3/common/logging";
import { ListModuleSettings } from "@woofx3/db/module_setting.pb";
import { GetSetting, SetSetting } from "@woofx3/db/setting.pb";
import TwitchClient, { requestTokenOverNats } from "@woofx3/twitch";
import type { TwitchConfig } from "../../config/twitch";
import { type Clock, errorMessage, type IdSource, type Logger } from "../../host/deps";
import type { BusMessage, ScopedBus } from "../../host/scoped-bus";
import type { DbProxyClientConfig } from "../../services/db-proxy";
import { AdBreakScheduler } from "./lib/adBreakScheduler";
import { AdBreakLeadSetting } from "./lib/adBreakSettings";
import { ChatterMembershipEnricher, DEFAULT_ENRICHER_OPTIONS, TwurpleMembershipLookup } from "./lib/chatterMembership";
import { HELIX_DEADLINE_MS } from "./lib/helix";
import { enqueueShoutoutOverNats } from "./lib/shoutoutQueue";
import type TwitchApiClient from "./lib/twitch";
import TwitchApiClientImpl, {
  isTwitchApiCommand,
  type TwitchApiCall,
  type TwitchApiReplyCode,
  twitchApiErrorCodeOf,
} from "./lib/twitch";
import TwitchEventBus from "./lib/twitchEventBus";

/**
 * Inbound request on the `twitchapi` subject: `{ command, args? }`.
 */
interface TwitchApiRequest {
  command: string;
  args?: Record<string, unknown>;
}

/**
 * The request carried by a `twitchapi` message. Two senders shape it
 * differently and both are served: the api wraps it in a CloudEvent
 * (`{ type, source, time, data: { command, args } }`), while the sandbox's
 * `ctx.twitch` and the chatbot's built-in commands send the bare
 * `{ command, args }`.
 */
export function parseTwitchApiRequest(body: unknown): TwitchApiRequest | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const record = body as { command?: unknown; data?: unknown };
  if (typeof record.command === "string") {
    return record as TwitchApiRequest;
  }
  if (record.data && typeof record.data === "object") {
    return record.data as TwitchApiRequest;
  }
  return null;
}

/**
 * The error name TwitchClient.init rejects with while no Twitch account is
 * linked. Must match TWITCH_NOT_LINKED in shared/clients/typescript/twitch;
 * not imported, because tests replace that module with a default-only mock.
 */
const TWITCH_NOT_LINKED = "TwitchNotLinked";

/** The CloudEvent type of every `twitchapi` refusal. Must match ERROR_REPLY_TYPE in barkloader's twitch extension. */
export const TWITCHAPI_ERROR_TYPE = "twitchapi.error";

/** The slice of the adapter's scoped bus the twitch application uses. */
export type TwitchBus = Pick<ScopedBus, "publish" | "subscribe" | "request">;

/** What one start of the twitch application runs with, and what it builds while connected. */
export type TwitchAppContext = {
  logger: Logger;
  bus: TwitchBus;
  db: DbProxyClientConfig;
  config: TwitchConfig;
  /** Absent until connected. */
  broadcaster?: HelixUser;
  twitchEventBus?: TwitchEventBus;
  /** Absent until connected. */
  twitchApi?: TwitchApiClient;
};

/** Stamps `twitchapi` replies. */
export interface TwitchReplyDeps {
  clock: Clock;
  ids: IdSource;
}

/** How a connect attempt ended. `not_linked`: no Twitch token is stored. */
export type ConnectOutcome = "connected" | "not_linked";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Twitch for one adapter run: EventSub to bus events, and the `twitchapi`
 * commands. The adapter builds one per start and stops it on stop.
 */
export default class TwitchApplication {
  constructor(private readonly deps: TwitchReplyDeps) {}

  /**
   * "waiting" while no Twitch account is linked, then "connected". The
   * adapter only starts once a token is stored, so waiting is brief: a race
   * with an unlink, or a relink that arrives mid-connect.
   */
  private link: "waiting" | "connecting" | "connected" = "waiting";
  private eventBus: TwitchEventBus | null = null;
  private twitchClient: TwitchClient | null = null;
  private adBreakScheduler: AdBreakScheduler | null = null;
  /** A token update arrived mid-connect; applied once the connect finishes. */
  private relinkPending = false;

  private async onTokenUpdated(ctx: TwitchAppContext): Promise<void> {
    switch (this.link) {
      case "waiting": {
        await this.connect(ctx);
        return;
      }
      case "connecting": {
        this.relinkPending = true;
        return;
      }
      case "connected": {
        await this.relink(ctx);
        return;
      }
    }
  }

  /**
   * Apply a relinked token while connected. Relinking is how a streamer
   * grants a scope the first link lacked, so the running auth provider has
   * to take the new token (it would otherwise keep refreshing the old one,
   * and its scopes), and every EventSub subscription is requested again so
   * one refused for a missing scope gets its retry.
   *
   * A relink to a different Twitch account changes the broadcaster, and one
   * to a token renewed another way (from the api service instead of with the
   * confidential app, or the reverse) needs a different auth provider.
   * Neither is covered by a token swap, so both reconnect from scratch.
   */
  private async relink(ctx: TwitchAppContext): Promise<void> {
    const client = this.twitchClient;
    const eventBus = this.eventBus;
    if (!client || !eventBus) {
      return;
    }
    const { userChanged, providerChanged } = await client.reloadToken();
    const broadcasterChanged = userChanged && ctx.config.channel === undefined;
    if (providerChanged || broadcasterChanged) {
      ctx.logger.info("twitch: Twitch was relinked with a token this connection cannot take; reconnecting", {
        providerChanged,
        broadcasterChanged,
      });
      eventBus.disconnect();
      this.adBreakScheduler?.stop();
      this.adBreakScheduler = null;
      await client.close();
      this.eventBus = null;
      this.twitchClient = null;
      ctx.twitchEventBus = undefined;
      ctx.twitchApi = undefined;
      ctx.broadcaster = undefined;
      await this.connect(ctx);
      return;
    }
    await eventBus.resubscribe();
    ctx.logger.info("twitch: relinked token applied", {
      established: eventBus.establishedCount(),
      expected: TwitchEventBus.expectedSubscriptionCount,
    });
  }

  /**
   * Listens for relinks, then connects. On `not_linked` nothing runs but that
   * listener, which the adapter's stop closes with the rest of its bus scope.
   */
  async start(ctx: TwitchAppContext): Promise<ConnectOutcome> {
    // Published when the streamer links (or relinks) Twitch in the UI. A
    // relink while connected swaps the token in place (see `relink`),
    // without a restart.
    await ctx.bus.subscribe(INTEGRATION_TOKEN_UPDATED_SUBJECT, async (msg: BusMessage) => {
      if (integrationOf(msg) !== "twitch") {
        return;
      }
      try {
        await this.onTokenUpdated(ctx);
      } catch (err) {
        ctx.logger.error("twitch: failed to apply the updated Twitch token", { err: errorMessage(err) });
      }
    });

    return this.connect(ctx);
  }

  /**
   * Connect to Twitch with the linked account, or stay waiting when none is
   * linked. The channel is the configured one when set, else the account
   * that linked Twitch.
   */
  private async connect(ctx: TwitchAppContext): Promise<ConnectOutcome> {
    this.link = "connecting";
    const db = ctx.db;
    const twitchClient = new TwitchClient({
      channel: ctx.config.channel,
      getSetting: async (key) => {
        const response = await GetSetting({ key }, db);
        return response.setting.value.stringValue ?? undefined;
      },
      setSetting: async (key, value) => {
        await SetSetting({ key, value: { stringValue: value }, userId: "" }, db);
      },
      requestToken: requestTokenOverNats(busRequest(ctx.bus)),
    });

    // Only an engine that refreshes Twitch tokens itself has an app of its
    // own; one whose token comes from a dashboard asks the dashboard instead.
    let authProvider: AuthProvider;
    try {
      authProvider = await twitchClient.init(ctx.config.app);
    } catch (err) {
      if (err instanceof Error && err.name === TWITCH_NOT_LINKED) {
        this.link = "waiting";
        this.relinkPending = false;
        ctx.logger.info("twitch: no Twitch account linked yet; waiting for a Twitch link");
        return "not_linked";
      }
      this.link = "waiting";
      throw err;
    }

    const apiClient = twitchClient.ApiClient();
    const listener = twitchClient.EventBusListener();
    const broadcaster = await twitchClient.broadcaster();

    const twitchApi = new TwitchApiClientImpl(
      apiClient,
      broadcaster,
      authProvider,
      enqueueShoutoutOverNats(busRequest(ctx.bus))
    );
    const events = new EventFactory({ source: "twitch" });
    const messageBus = ctx.bus;
    const adBreakLeadSetting = new AdBreakLeadSetting(
      {
        listModuleSettings: async (moduleId) => (await ListModuleSettings({ moduleId }, db)).settings,
      },
      ctx.logger
    );
    const adBreakScheduler = new AdBreakScheduler({
      fetchSchedule: () => twitchApi.getAdSchedule({}),
      publishUpcoming: (event) => {
        const [topic, data] = events.Twitch().adBreakUpcoming(event);
        messageBus.publish(topic, data);
      },
      logger: ctx.logger,
      readLeadSeconds: () => adBreakLeadSetting.read(),
    });

    const eventBusCtx = {
      broadcaster,
      logger: ctx.logger,
      messageBus,
      events,
      membershipEnricher: this.buildMembershipEnricher(ctx, apiClient),
      onStreamLiveChange: (live: boolean) => adBreakScheduler.setLive(live),
    };
    const twitchEventBus = new TwitchEventBus(eventBusCtx, listener);
    await twitchEventBus.start();
    if (!twitchEventBus.isReady()) {
      // Deliberately not fatal: the `twitchapi` request/reply surface is
      // still worth serving, and Twurple keeps retrying refused
      // subscriptions. The adapter's /health detail shows the shortfall.
      ctx.logger.error("Twitch EventSub subscriptions incomplete; no events arrive for the missing ones", {
        established: twitchEventBus.establishedCount(),
        expected: TwitchEventBus.expectedSubscriptionCount,
        failures: twitchEventBus.failedSubscriptions(),
      });
    }

    ctx.broadcaster = broadcaster;
    ctx.twitchApi = twitchApi;
    ctx.twitchEventBus = twitchEventBus;
    this.eventBus = twitchEventBus;
    this.twitchClient = twitchClient;
    this.adBreakScheduler = adBreakScheduler;
    void this.seedLiveState(ctx, apiClient, broadcaster.id, adBreakScheduler);
    this.link = "connected";
    ctx.logger.info("twitch: connected", { broadcasterId: broadcaster.id });
    if (this.relinkPending) {
      this.relinkPending = false;
      await this.relink(ctx);
    }
    return "connected";
  }

  /**
   * EventSub does not replay a stream.online that happened before this
   * service connected, so a service started mid-stream asks Helix once.
   * A failed read leaves the scheduler offline until the next online event:
   * a missed heads-up is better than polling a stream that is not live.
   */
  private async seedLiveState(
    ctx: TwitchAppContext,
    apiClient: ApiClient,
    broadcasterId: string,
    scheduler: AdBreakScheduler
  ): Promise<void> {
    try {
      const stream = await apiClient.streams.getStreamByUserId(broadcasterId);
      scheduler.seedLive(stream !== null);
    } catch (err) {
      ctx.logger.warn("twitch: could not read whether the stream is live; ad heads-up waits for stream.online", {
        err: errorMessage(err),
      });
    }
  }

  /**
   * Follower status and subscription tier have to be read from Helix - no
   * badge carries either. Returns undefined when enrichment is switched off,
   * in which case both fields stay absent and grants against the follower and
   * tier groups simply match nobody, rather than matching everybody.
   */
  private buildMembershipEnricher(ctx: TwitchAppContext, apiClient: ApiClient): ChatterMembershipEnricher | undefined {
    const membership = ctx.config.membership;
    if (membership === undefined) {
      ctx.logger.info("twitch: chatter membership enrichment disabled by config");
      return undefined;
    }
    return new ChatterMembershipEnricher(new TwurpleMembershipLookup(apiClient), ctx.logger, {
      ...DEFAULT_ENRICHER_OPTIONS,
      ttlMs: membership.ttlMs,
      deadlineMs: membership.deadlineMs,
    });
  }

  /**
   * How many EventSub subscriptions Twitch has confirmed. An unsubscribed
   * listener is silent, not merely degraded, so a shortfall here means some
   * Twitch events are not reaching the engine at all.
   */
  eventSubStatus(): { established: number; expected: number; ready: boolean } {
    return {
      established: this.eventBus?.establishedCount() ?? 0,
      expected: TwitchEventBus.expectedSubscriptionCount,
      ready: this.eventBus?.isReady() ?? false,
    };
  }

  async stop(ctx: TwitchAppContext): Promise<void> {
    this.adBreakScheduler?.stop();
    this.adBreakScheduler = null;
    ctx.twitchEventBus?.disconnect();
  }

  /**
   * Answers one `twitchapi` request with the reply bytes. `deadline` is the
   * clock time the reply is due by; a `helix` call gives up at it, or at its
   * own deadline when that comes first.
   */
  async handleTwitchApiRequest(ctx: TwitchAppContext, body: Uint8Array, deadline: number): Promise<Uint8Array> {
    return withSpan("twitchapi.request", (span) => this.answer(ctx, body, deadline, span), {
      attributes: { "messaging.destination.name": TWITCHAPI_SUBJECT, "messaging.system": "nats" },
      kind: SpanKind.CONSUMER,
    });
  }

  private async answer(ctx: TwitchAppContext, body: Uint8Array, deadline: number, span: Span): Promise<Uint8Array> {
    let request: TwitchApiRequest | null;
    try {
      request = parseTwitchApiRequest(JSON.parse(decoder.decode(body)));
    } catch (err) {
      ctx.logger.error("twitchapi: failed to parse request", { err: errorMessage(err) });
      return this.errorReply("Invalid request payload");
    }

    if (!request?.command) {
      return this.errorReply("Missing command");
    }

    if (!ctx.twitchApi) {
      // Only `helix` carries a code here: every other command's contract,
      // and `ctx.twitch`'s with it, documents this refusal as uncoded.
      return this.errorReply(
        "Twitch is not linked yet: the streamer has to connect Twitch first",
        request.command === HELIX_COMMAND ? "not_linked" : undefined
      );
    }

    if (!isTwitchApiCommand(request.command)) {
      ctx.logger.warn("twitchapi: unknown command", { command: request.command });
      return this.errorReply(`Unknown command: ${request.command}`);
    }

    span.updateName(`twitchapi.${request.command}`);
    span.setAttribute("rpc.method", request.command);

    const twitchApi = ctx.twitchApi as unknown as Record<
      string,
      (input: unknown, call: TwitchApiCall) => Promise<unknown>
    >;
    const call: TwitchApiCall = {
      helixDeadlineMs: Math.max(0, Math.min(HELIX_DEADLINE_MS, deadline - this.deps.clock.now())),
    };

    try {
      const result = await twitchApi[request.command](request.args ?? {}, call);
      return twitchApiReply(`twitchapi.${request.command}.result`, result, this.deps);
    } catch (err) {
      const message = errorMessage(err);
      ctx.logger.error("twitchapi: handler failed", { command: request.command, err: message });
      return this.errorReply(message, twitchApiErrorCodeOf(err));
    }
  }

  private errorReply(error: string, code?: TwitchApiReplyCode): Uint8Array {
    return twitchApiErrorReply(error, code, this.deps);
  }
}

/**
 * A `twitchapi.error` reply. `code` is set when the failure is one a caller
 * can act on differently (e.g. `missing_scope` means relink Twitch,
 * `rate_limited` means wait); absent for everything else.
 */
export function twitchApiErrorReply(
  error: string,
  code: TwitchApiReplyCode | undefined,
  deps: TwitchReplyDeps
): Uint8Array {
  return twitchApiReply(TWITCHAPI_ERROR_TYPE, code ? { error, code } : { error }, deps);
}

/** A `twitchapi` reply: a CloudEvent of `type` around `data`, with source `twitchapi`. */
function twitchApiReply(type: string, data: unknown, deps: TwitchReplyDeps): Uint8Array {
  return encoder.encode(
    JSON.stringify({
      id: deps.ids.next(),
      type,
      source: TWITCHAPI_SUBJECT,
      time: new Date(deps.clock.now()).toISOString(),
      data,
    })
  );
}

/**
 * The scoped bus as the shared request helpers call it. Both always pass a
 * timeout; a call without one is a wiring mistake, so it is refused rather
 * than given an invented default.
 */
function busRequest(
  bus: TwitchBus
): (subject: string, data: Uint8Array, opts?: { timeout?: number }) => Promise<{ data: Uint8Array }> {
  return (subject, data, opts) => {
    const timeout = opts?.timeout;
    if (timeout === undefined) {
      return Promise.reject(new Error(`a request on ${subject} needs a timeout`));
    }
    return bus.request(subject, data, { timeout });
  };
}

/** The integration a `setting.integration.token.updated` CloudEvent names, or undefined for any other body. */
function integrationOf(msg: BusMessage): unknown {
  try {
    const event = JSON.parse(decoder.decode(msg.data)) as { data?: { integration?: unknown } } | null;
    return event?.data?.integration;
  } catch {
    return undefined;
  }
}
