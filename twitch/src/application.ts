import type { HelixUser } from "@twurple/api";
import EventFactory from "@woofx3/common/cloudevents/EventFactory";
import type { Application, IApplication } from "@woofx3/common/runtime";
import type { Msg } from "@woofx3/nats/src/types";
import TwitchClient from "@woofx3/twitch";
import chalk from "chalk";
import type { Logger } from "winston";
import type TwitchApiClient from "./lib/twitch";
import type { CommandResponse } from "./lib/twitch";
import TwitchApiClientImpl from "./lib/twitch";
import TwitchEventBus from "./lib/twitchEventBus";
import type DbProxyService from "./services/dbProxy";
import type MessageBusService from "./services/messageBus";

export type TwitchApiServices = {
  dbProxy: DbProxyService;
  messageBus: MessageBusService;
};

export type TwitchApiContext = {
  broadcaster: HelixUser;
  logger: Logger;
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
    const twitchClient = new TwitchClient({
      applicationId: ctx.config.getConfig("woofx3ApplicationId") as string,
      channel: ctx.config.getConfig("woofx3TwitchChannelName") as string,
      databaseURL: ctx.services.dbProxy.client.baseURL,
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

    // listen on the eventbus for api calls
    await ctx.services.messageBus.client.subscribe("twitchapi", (msg: Msg) => {
      ctx.logger.info("received message", { msg });
      // natsMessageHandler<TwitchApiRequestMessage>(msg, (command: string, args: Record<string, string>) =>
      //   this.twitchApiMessageHandlerWithBroadcaster(ctx, command, args)
      // );
    });
  }

  async run(ctx: TwitchApiContext) {
    console.log(chalk.redBright(`===================== STARTING TWITCH ===========================  `));
    console.log(chalk.redBright(`Broadcaster Id: ${ctx.broadcaster.id}`));
  }

  async terminate(ctx: TwitchApiContext) {
    ctx.twitchEventBus?.disconnect();
  }

  private twitchApiMessageHandlerWithBroadcaster = (
    ctx: TwitchApiContext,
    command: string,
    args: Record<string, string>
  ) => {
    return this.twitchApiMessageHandler(ctx, command, args);
  };

  private async twitchApiMessageHandler(ctx: TwitchApiContext, command: string, args: Record<string, string>) {
    // command does not exist
    if (!(command in ctx.twitchApi)) {
      return false;
    }

    // invoke twitch api
    const commandHandler = (
      ctx.twitchApi as unknown as Record<string, (input: Record<string, string>) => Promise<CommandResponse>>
    )[command];
    const result = await commandHandler(args);

    // do we need to send out a new message
    if (result.command) {
      const payload = new TextEncoder().encode(
        JSON.stringify({
          command: result.command.command,
          args: result.command.args,
        })
      );
      ctx.services.messageBus.client.publish(result.command.topic, payload);
    }

    if (result.error) {
      // handle the error
      ctx.logger.error(result.message);
    }

    return true;
  }
}
