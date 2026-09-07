import type { HelixUser } from "@twurple/api";
import EventFactory from "@woofx3/common/cloudevents/EventFactory";
import { type Span, type SharedLogger, SpanKind, withSpan } from "@woofx3/common/logging";
import type { Application, IApplication } from "@woofx3/common/runtime";
import { GetSetting, SetSetting } from "@woofx3/db/setting.pb";
import type { Msg } from "@woofx3/nats/src/types";
import TwitchClient from "@woofx3/twitch";
import chalk from "chalk";
import type TwitchApiClient from "./lib/twitch";
import TwitchApiClientImpl from "./lib/twitch";
import TwitchEventBus from "./lib/twitchEventBus";
import type DbProxyService from "./services/dbProxy";
import type MessageBusService from "./services/messageBus";

/**
 * Inbound request envelope on the `twitchapi` subject. Engine wraps the
 * caller's payload as a CloudEvent ({type, source, time, data: {...}}),
 * and the actual dispatch fields live under `data`.
 */
interface TwitchApiRequest {
  command: string;
  args?: Record<string, unknown>;
}

export type TwitchApiServices = {
  dbProxy: DbProxyService;
  messageBus: MessageBusService;
};

export type TwitchApiContext = {
  broadcaster: HelixUser;
  logger: SharedLogger;
  services: TwitchApiServices;
  twitchEventBus?: TwitchEventBus;
  twitchApi: TwitchApiClient;
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

  async init(ctx: TwitchApiContext) {
    const dbBaseURL = ctx.services.dbProxy.client.baseURL;
    const twitchClient = new TwitchClient({
      channel: ctx.config.getConfig("woofx3TwitchChannelName") as string,
      getSetting: async (key) => {
        const response = await GetSetting({ applicationId: "", key }, { baseURL: dbBaseURL });
        return response.setting.value.stringValue ?? undefined;
      },
      setSetting: async (key, value) => {
        await SetSetting({ applicationId: "", key, value: { stringValue: value }, userId: "" }, { baseURL: dbBaseURL });
      },
    });

    await twitchClient.init({
      clientId: ctx.config.getConfig("woofx3TwitchClientId") as string,
      clientSecret: ctx.config.getConfig("woofx3TwitchClientSecret") as string,
      redirectUri: ctx.config.getConfig("woofx3TwitchRedirectUrl") as string,
    });

    const apiClient = twitchClient.ApiClient();
    const listener = twitchClient.EventBusListener();
    const broadcaster = await twitchClient.broadcaster();

    const eventBusCtx = {
      broadcaster,
      logger: ctx.logger,
      messageBus: ctx.services.messageBus.client,
      events: new EventFactory({ source: "twitch" }),
    };
    const twitchEventBus = new TwitchEventBus(eventBusCtx, listener);
    await twitchEventBus.start();
    if (!twitchEventBus.isReady()) {
      // Deliberately not fatal: the `twitchapi` request/reply surface is
      // still worth serving, and Twurple keeps retrying refused
      // subscriptions. But the service must not claim to be healthy while
      // it is receiving no Twitch events — see `isEventBusReady`, which
      // feeds the heartbeat's `ready` flag.
      ctx.logger.error("Twitch EventSub subscriptions incomplete; service is NOT ready", {
        established: twitchEventBus.establishedCount(),
        expected: TwitchEventBus.expectedSubscriptionCount,
        failures: twitchEventBus.failedSubscriptions(),
      });
    }

    ctx.broadcaster = broadcaster;
    ctx.twitchApi = new TwitchApiClientImpl(apiClient, broadcaster);
    ctx.twitchEventBus = twitchEventBus;

    await ctx.services.messageBus.client.subscribe("twitchapi", (msg: Msg) => {
      void withSpan("twitchapi.request", (span) => this.handleTwitchApiRequest(ctx, msg, span), {
        attributes: { "messaging.destination.name": "twitchapi", "messaging.system": "nats" },
        kind: SpanKind.CONSUMER,
      }).catch((err) => {
        ctx.logger.error("twitchapi: request handling failed", { err });
      });
    });
  }

  /**
   * Readiness reported on the heartbeat. False until Twitch has confirmed
   * every EventSub subscription: an unsubscribed listener is silent, not
   * merely degraded, so reporting ready would hide a total outage of the
   * Twitch integration.
   */
  isEventBusReady(): boolean {
    return this.context.twitchEventBus?.isReady() ?? false;
  }

  async run(ctx: TwitchApiContext) {
    console.log(chalk.redBright(`===================== STARTING TWITCH ===========================  `));
    console.log(chalk.redBright(`Broadcaster Id: ${ctx.broadcaster.id}`));
  }

  async terminate(ctx: TwitchApiContext) {
    ctx.twitchEventBus?.disconnect();
  }

  private async handleTwitchApiRequest(ctx: TwitchApiContext, msg: Msg, span?: Span) {
    const isRequest = !!msg.reply;
    let request: TwitchApiRequest | null = null;
    try {
      const envelope = msg.json<{ data?: TwitchApiRequest }>();
      request = envelope.data as TwitchApiRequest;
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

    if (!(request.command in ctx.twitchApi)) {
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
        this.respondError(msg, message);
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

  private respondError(msg: Msg, error: string) {
    const envelope = {
      id: crypto.randomUUID(),
      type: "twitchapi.error",
      source: "twitchapi",
      time: new Date().toISOString(),
      data: { error },
    };
    msg.respond(new TextEncoder().encode(JSON.stringify(envelope)));
  }
}
