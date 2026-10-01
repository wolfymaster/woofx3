import type { ApiClient, HelixUser } from "@twurple/api";
import EventFactory from "@woofx3/common/cloudevents/EventFactory";
import { subscribeToSessionUpdates } from "@woofx3/common/cloudevents/session-subscriber";
import { type Span, type SharedLogger, SpanKind, withSpan } from "@woofx3/common/logging";
import type { Application, IApplication } from "@woofx3/common/runtime";
import { ListModuleSettings } from "@woofx3/db/module_setting.pb";
import { GetSetting, SetSetting } from "@woofx3/db/setting.pb";
import type { Msg } from "@woofx3/nats/src/types";
import TwitchClient from "@woofx3/twitch";
import chalk from "chalk";
import { AdBreakScheduler } from "./lib/adBreakScheduler";
import { AdBreakLeadSetting } from "./lib/adBreakSettings";
import type TwitchApiClient from "./lib/twitch";
import TwitchApiClientImpl, { isTwitchApiCommand, twitchApiErrorCodeOf } from "./lib/twitch";
import { ChatterMembershipEnricher, DEFAULT_ENRICHER_OPTIONS, TwurpleMembershipLookup } from "./lib/chatterMembership";
import TwitchEventBus from "./lib/twitchEventBus";
import type DbProxyService from "./services/dbProxy";
import type MessageBusService from "./services/messageBus";

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

export type TwitchApiServices = {
  dbProxy: DbProxyService;
  messageBus: MessageBusService;
};

export type TwitchApiContext = {
  /** Absent until a Twitch account is linked; see `TwitchApi.connect`. */
  broadcaster?: HelixUser;
  logger: SharedLogger;
  services: TwitchApiServices;
  twitchEventBus?: TwitchEventBus;
  /** Absent until a Twitch account is linked. */
  twitchApi?: TwitchApiClient;
  config: {
    getConfig: (key: string) => unknown;
  };
};

export type TwitchApiApplication = Application<TwitchApiContext, TwitchApiServices>;

export default class TwitchApi implements IApplication<TwitchApiContext, TwitchApiServices> {
  readonly context: TwitchApiContext;
  readonly __finalContextType!: TwitchApiContext;

  constructor() {
    this.context = { services: {} } as unknown as TwitchApiContext;
  }

  /**
   * "waiting" until a Twitch account is linked, then "connected". A fresh
   * engine exists before its streamer links Twitch, so waiting is a normal,
   * healthy state rather than a failure to restart out of.
   */
  private link: "waiting" | "connecting" | "connected" = "waiting";
  private eventBus: TwitchEventBus | null = null;
  private twitchClient: TwitchClient | null = null;
  private adBreakScheduler: AdBreakScheduler | null = null;
  /** A token update arrived mid-connect; applied once the connect finishes. */
  private relinkPending = false;

  private async onTokenUpdated(ctx: TwitchApiContext): Promise<void> {
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
   * A relink to a different Twitch account changes the broadcaster, which a
   * token swap cannot cover, so that case reconnects from scratch.
   */
  private async relink(ctx: TwitchApiContext): Promise<void> {
    const client = this.twitchClient;
    const eventBus = this.eventBus;
    if (!client || !eventBus) {
      return;
    }
    const { userChanged } = await client.reloadToken();
    if (userChanged && !ctx.config.getConfig("woofx3TwitchChannelName")) {
      ctx.logger.info("twitch: Twitch was relinked to a different account; reconnecting");
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

  async init(ctx: TwitchApiContext) {
    // Before anything starts publishing. Every event this service emits is
    // stamped with the session this holder learns from the bus, and
    // TwitchEventBus begins emitting the moment it starts.
    await subscribeToSessionUpdates(ctx.services.messageBus.client, ctx.logger);

    await ctx.services.messageBus.client.subscribe("twitchapi", (msg: Msg) => {
      void withSpan("twitchapi.request", (span) => this.handleTwitchApiRequest(ctx, msg, span), {
        attributes: { "messaging.destination.name": "twitchapi", "messaging.system": "nats" },
        kind: SpanKind.CONSUMER,
      }).catch((err) => {
        ctx.logger.error("twitchapi: request handling failed", { err });
      });
    });

    // Published when the streamer links (or relinks) Twitch in the UI. A
    // first link moves a waiting service to connected; a relink while
    // connected swaps the token in place (see `relink`). Both without a
    // restart.
    await ctx.services.messageBus.client.subscribe("setting.integration.token.updated", async (msg: Msg) => {
      const integration = msg.json<{ data?: { integration?: string } }>()?.data?.integration;
      if (integration !== "twitch") {
        return;
      }
      try {
        await this.onTokenUpdated(ctx);
      } catch (err) {
        ctx.logger.error("twitch: failed to apply the updated Twitch token", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    });

    await this.connect(ctx);
  }

  /**
   * Connect to Twitch with the linked account, or stay waiting when none is
   * linked. The channel is the configured one when set, else the account
   * that linked Twitch.
   */
  private async connect(ctx: TwitchApiContext): Promise<void> {
    this.link = "connecting";
    const dbBaseURL = ctx.services.dbProxy.client.baseURL;
    const channel = ctx.config.getConfig("woofx3TwitchChannelName") as string | undefined;
    const twitchClient = new TwitchClient({
      channel: channel || undefined,
      getSetting: async (key) => {
        const response = await GetSetting({ key }, { baseURL: dbBaseURL });
        return response.setting.value.stringValue ?? undefined;
      },
      setSetting: async (key, value) => {
        await SetSetting({ key, value: { stringValue: value }, userId: "" }, { baseURL: dbBaseURL });
      },
    });

    try {
      await twitchClient.init({
        clientId: ctx.config.getConfig("woofx3TwitchClientId") as string,
        clientSecret: ctx.config.getConfig("woofx3TwitchClientSecret") as string,
        redirectUri: ctx.config.getConfig("woofx3TwitchRedirectUrl") as string,
      });
    } catch (err) {
      if (err instanceof Error && err.name === TWITCH_NOT_LINKED) {
        this.link = "waiting";
        this.relinkPending = false;
        ctx.logger.info("twitch: no Twitch account linked yet; waiting for a Twitch link");
        return;
      }
      this.link = "waiting";
      throw err;
    }

    const apiClient = twitchClient.ApiClient();
    const listener = twitchClient.EventBusListener();
    const broadcaster = await twitchClient.broadcaster();

    const twitchApi = new TwitchApiClientImpl(apiClient, broadcaster);
    const events = new EventFactory({ source: "twitch" });
    const messageBus = ctx.services.messageBus.client;
    const adBreakLeadSetting = new AdBreakLeadSetting(
      {
        listModuleSettings: async (moduleId) =>
          (await ListModuleSettings({ moduleId }, { baseURL: dbBaseURL })).settings,
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
      // subscriptions. But the service must not claim to be healthy while
      // it is receiving no Twitch events — see `isReady`, which feeds the
      // heartbeat's `ready` flag.
      ctx.logger.error("Twitch EventSub subscriptions incomplete; service is NOT ready", {
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
  }

  /**
   * EventSub does not replay a stream.online that happened before this
   * service connected, so a service started mid-stream asks Helix once.
   * A failed read leaves the scheduler offline until the next online event:
   * a missed heads-up is better than polling a stream that is not live.
   */
  private async seedLiveState(
    ctx: TwitchApiContext,
    apiClient: ApiClient,
    broadcasterId: string,
    scheduler: AdBreakScheduler
  ): Promise<void> {
    try {
      const stream = await apiClient.streams.getStreamByUserId(broadcasterId);
      scheduler.seedLive(stream !== null);
    } catch (err) {
      ctx.logger.warn("twitch: could not read whether the stream is live; ad heads-up waits for stream.online", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Follower status and subscription tier have to be read from Helix - no
   * badge carries either. Returns undefined when enrichment is switched off,
   * in which case both fields stay absent and grants against the follower and
   * tier groups simply match nobody, rather than matching everybody.
   */
  private buildMembershipEnricher(ctx: TwitchApiContext, apiClient: ApiClient): ChatterMembershipEnricher | undefined {
    if (ctx.config.getConfig("woofx3TwitchMembershipEnrichmentEnabled") === false) {
      ctx.logger.info("twitch: chatter membership enrichment disabled by config");
      return undefined;
    }
    return new ChatterMembershipEnricher(new TwurpleMembershipLookup(apiClient), ctx.logger, {
      ...DEFAULT_ENRICHER_OPTIONS,
      ttlMs: ctx.config.getConfig("woofx3TwitchMembershipTtlMs") as number,
      deadlineMs: ctx.config.getConfig("woofx3TwitchMembershipDeadlineMs") as number,
    });
  }

  /**
   * Readiness reported on the heartbeat. Waiting for a Twitch link is ready:
   * nothing is wrong, there is only nothing to connect to yet. Once
   * connecting, false until Twitch has confirmed every EventSub
   * subscription: an unsubscribed listener is silent, not merely degraded,
   * so reporting ready would hide a total outage of the Twitch integration.
   */
  isReady(): boolean {
    if (this.link === "waiting") {
      return true;
    }
    return this.eventBus?.isReady() ?? false;
  }

  async run(ctx: TwitchApiContext) {
    console.log(chalk.redBright(`===================== STARTING TWITCH ===========================  `));
    console.log(chalk.redBright(`Broadcaster Id: ${ctx.broadcaster?.id ?? "(waiting for a Twitch link)"}`));
  }

  async terminate(ctx: TwitchApiContext) {
    this.adBreakScheduler?.stop();
    this.adBreakScheduler = null;
    ctx.twitchEventBus?.disconnect();
  }

  private async handleTwitchApiRequest(ctx: TwitchApiContext, msg: Msg, span?: Span) {
    const isRequest = !!msg.reply;
    let request: TwitchApiRequest | null = null;
    try {
      request = parseTwitchApiRequest(msg.json<unknown>());
    } catch (err) {
      ctx.logger.error("twitchapi: failed to parse request", { err });
      if (isRequest) {
        this.respondError(msg, "Invalid request payload");
      }
      return;
    }

    if (!request?.command) {
      if (isRequest) {
        this.respondError(msg, "Missing command");
      }
      return;
    }

    if (!ctx.twitchApi) {
      if (isRequest) {
        this.respondError(msg, "Twitch is not linked yet: the streamer has to connect Twitch first");
      }
      return;
    }

    if (!isTwitchApiCommand(request.command)) {
      ctx.logger.warn("twitchapi: unknown command", { command: request.command });
      if (isRequest) {
        this.respondError(msg, `Unknown command: ${request.command}`);
      }
      return;
    }

    span?.updateName(`twitchapi.${request.command}`);
    span?.setAttribute("rpc.method", request.command);

    const twitchApi = ctx.twitchApi as unknown as Record<string, (input: unknown) => Promise<unknown>>;

    try {
      const result = await twitchApi[request.command](request.args ?? {});
      if (isRequest) {
        this.respondSuccess(msg, request.command, result);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.logger.error("twitchapi: handler failed", { command: request.command, err: message });
      if (isRequest) {
        this.respondError(msg, message, twitchApiErrorCodeOf(err));
      }
    }
  }

  private respondSuccess(msg: Msg, command: string, data: unknown) {
    const envelope = {
      id: crypto.randomUUID(),
      type: `twitchapi.${command}.result`,
      source: "twitchapi",
      time: new Date().toISOString(),
      data,
    };
    msg.respond(new TextEncoder().encode(JSON.stringify(envelope)));
  }

  /**
   * `code` is set when the failure is one a caller can act on differently
   * (e.g. `missing_scope` means relink Twitch, `rate_limited` means wait);
   * absent for everything else.
   */
  private respondError(msg: Msg, error: string, code?: string) {
    const envelope = {
      id: crypto.randomUUID(),
      type: "twitchapi.error",
      source: "twitchapi",
      time: new Date().toISOString(),
      data: code ? { error, code } : { error },
    };
    msg.respond(new TextEncoder().encode(JSON.stringify(envelope)));
  }
}
