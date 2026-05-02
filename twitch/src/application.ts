import type { HelixUser } from "@twurple/api";
import EventFactory from "@woofx3/common/cloudevents/EventFactory";
import type { SharedLogger } from "@woofx3/common/logging";
import type { Application, IApplication } from "@woofx3/common/runtime";
import { GetSetting } from "@woofx3/db/setting.pb";
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
    twitchEventBus.connect();
    twitchEventBus.subscribe();

    ctx.broadcaster = broadcaster;
    ctx.twitchApi = new TwitchApiClientImpl(apiClient, broadcaster);
    ctx.twitchEventBus = twitchEventBus;

    // Listen on the message bus for API requests. Compatible with NATS
    // request/reply: when the message has `reply` set (engine dispatched
    // via nats.request()), the handler responds via msg.respond() so the
    // engine's muxed inbox catches the reply and forwards it to Convex.
    // No more publish-back to a topic — callers that need to fan out the
    // result to other subjects do that themselves.
    await ctx.services.messageBus.client.subscribe("twitchapi", (msg: Msg) => {
      void this.handleTwitchApiRequest(ctx, msg);
    });
  }

  async run(ctx: TwitchApiContext) {
    console.log(chalk.redBright(`===================== STARTING TWITCH ===========================  `));
    console.log(chalk.redBright(`Broadcaster Id: ${ctx.broadcaster.id}`));
  }

  async terminate(ctx: TwitchApiContext) {
    ctx.twitchEventBus?.disconnect();
  }

  /**
   * Handle one request on the `twitchapi` subject. Parses the CloudEvent
   * envelope, dispatches by command name, and replies via msg.respond
   * (when the message was a request) with a CloudEvent envelope wrapping
   * the result. Errors are also returned via msg.respond so the engine
   * can forward them back to Convex with status="error".
   */
  private async handleTwitchApiRequest(ctx: TwitchApiContext, msg: Msg) {
    const isRequest = !!msg.reply;
    let request: TwitchApiRequest | null = null;
    try {
      const envelope = msg.json<{ data?: TwitchApiRequest } | TwitchApiRequest>();
      // Accept either a CloudEvent envelope or a bare {command, args}
      // payload — same accommodation the engine RPC handler makes.
      request =
        envelope && typeof envelope === "object" && "data" in envelope && envelope.data
          ? (envelope.data as TwitchApiRequest)
          : (envelope as TwitchApiRequest);
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

    const handler = (ctx.twitchApi as unknown as Record<string, (input: unknown) => Promise<unknown>>)[
      request.command
    ];

    try {
      const result = await handler(request.args ?? {});
      ctx.logger.info("twitchapi: handled command", { command: request.command });
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
